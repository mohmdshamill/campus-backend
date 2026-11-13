import { prisma } from '../../config/db';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors';
import {
  CreateBookingInput,
  ApproveBookingInput,
  RejectBookingInput,
  CancelBookingInput,
} from './bookings.dto';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationService } from '../notifications/notifications.service';
import {
  BookingStatus,
  DayOfWeek,
  MaintenanceStatus,
  NotificationType,
  ResourceMaintenanceStatus,
  ResourceType,
  Role,
} from '@prisma/client';
import { checkDepartmentAccess } from '../../middleware/role.middleware';

export class BookingService {
  /**
   * Concurrency-safe booking creation.
   * Utilizes PostgreSQL transactions and pessimistic row locking (FOR UPDATE)
   * on the target resource to guarantee that simultaneous requests cannot book
   * conflicting intervals.
   */
  static async createBooking(
    input: CreateBookingInput,
    userId: string,
    userEmail: string,
    ipAddress?: string
  ) {
    const start = new Date(input.startDateTime);
    const end = new Date(input.endDateTime);
    const now = new Date();

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestError('Invalid date-time format provided');
    }

    if (start >= end) {
      throw new BadRequestError('Start time must be strictly before end time');
    }

    // Execute within a PostgreSQL transaction with pessimistic row lock
    const newBooking = await prisma.$transaction(async (tx) => {
      // 1. Lock the resource row for update to serialize concurrent booking attempts
      const lockedResourceRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT id FROM "Resource" WHERE id = $1 FOR UPDATE',
        input.resourceId
      );

      if (!lockedResourceRows || lockedResourceRows.length === 0) {
        throw new NotFoundError('Resource not found');
      }

      // Fetch the full resource details inside the transaction
      const resource = await tx.resource.findUnique({
        where: { id: input.resourceId },
        include: { department: true },
      });

      if (!resource) {
        throw new NotFoundError('Resource not found');
      }

      if (!resource.isActive) {
        throw new BadRequestError('This resource is currently deactivated and not available for booking');
      }

      // Students may only book resources of their own department.
      // Shared venues (auditorium / seminar hall) are open to everyone.
      const bookingUser = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, departmentId: true },
      });
      const isSharedVenue =
        resource.type === ResourceType.AUDITORIUM ||
        resource.type === ResourceType.SEMINAR_HALL ||
        resource.type === ResourceType.MEETING_ROOM;
      if (
        bookingUser?.role === Role.STUDENT &&
        !isSharedVenue &&
        bookingUser.departmentId !== resource.departmentId
      ) {
        throw new ForbiddenError(
          `You can only book resources of your own department. This resource belongs to ${resource.department.name}.`
        );
      }

      if (resource.maintenanceStatus === ResourceMaintenanceStatus.UNDER_MAINTENANCE) {
        throw new ConflictError('This resource is currently under maintenance');
      }

      // 2. Operating hours apply to classrooms/labs only.
      //    Auditorium, seminar hall and conference room can be booked for any time, including nights.
      const formatTime = (d: Date) =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: process.env.COLLEGE_TIMEZONE || 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(d);
      const to12 = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number);
        return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
      };

      const startHHMM = formatTime(start);
      const endHHMM = formatTime(end);

      const hasOperatingHours = !isSharedVenue;
      if (
        hasOperatingHours &&
        (startHHMM < resource.operatingHoursStart || endHHMM > resource.operatingHoursEnd)
      ) {
        throw new BadRequestError(
          `Booking must be within ${to12(resource.operatingHoursStart)} - ${to12(resource.operatingHoursEnd)}. You selected ${to12(startHHMM)} - ${to12(endHHMM)}.`
        );
      }

      // 5. Check conflict with Maintenance records
      // Half-open interval collision: start < m.endDateTime AND end > m.startDateTime
      const conflictingMaintenance = await tx.maintenanceRecord.findFirst({
        where: {
          resourceId: resource.id,
          status: { in: [MaintenanceStatus.REPORTED, MaintenanceStatus.IN_PROGRESS] },
          startDateTime: { lt: end },
          endDateTime: { gt: start },
        },
      });

      if (conflictingMaintenance) {
        throw new ConflictError(
          `Resource is scheduled for maintenance during this interval: "${conflictingMaintenance.title}"`,
          { maintenanceId: conflictingMaintenance.id }
        );
      }

      // 6. Check conflict with Academic Schedules (recurring timetable)
      const dayName = new Intl.DateTimeFormat('en-US', {
        timeZone: process.env.COLLEGE_TIMEZONE || 'Asia/Kolkata',
        weekday: 'long',
      }).format(start).toUpperCase() as DayOfWeek;

      const academicClasses = await tx.academicSchedule.findMany({
        where: {
          resourceId: resource.id,
          dayOfWeek: dayName,
          isActive: true,
        },
        include: { department: true },
      });

      for (const cls of academicClasses) {
        // Half-open check with time strings: [cls.startTime, cls.endTime)
        if (startHHMM < cls.endTime && endHHMM > cls.startTime) {
          const deptName = cls.department?.name || resource.department?.name || 'Academic Department';
          throw new ConflictError(
            `Already booked: ${cls.courseName} (${cls.courseCode}) for ${deptName}, ${to12(cls.startTime)} - ${to12(cls.endTime)}.`,
            { classId: cls.id, course: cls.courseName, department: deptName }
          );
        }
      }

      // 7. Check conflict with College Events
      const conflictingEvent = await tx.collegeEvent.findFirst({
        where: {
          resourceId: resource.id,
          isCancelled: false,
          startDateTime: { lt: end },
          endDateTime: { gt: start },
        },
      });

      if (conflictingEvent) {
        const confStart = formatTime(conflictingEvent.startDateTime);
        const confEnd = formatTime(conflictingEvent.endDateTime);
        const eventOrganizer = conflictingEvent.organizer || 'Another Department';
        throw new ConflictError(
          `Already booked by ${eventOrganizer} for event "${conflictingEvent.title}", ${to12(confStart)} - ${to12(confEnd)}.`,
          { eventId: conflictingEvent.id, title: conflictingEvent.title }
        );
      }

      // 8. Check conflict with existing Bookings (APPROVED or PENDING)
      // Half-open interval intersection: start < b.endDateTime AND end > b.startDateTime
      const conflictingBooking = await tx.booking.findFirst({
        where: {
          resourceId: resource.id,
          // Same date & time = place cannot be booked again. Only a cancelled booking frees the slot.
          status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING, BookingStatus.REJECTED] },
          startDateTime: { lt: end },
          endDateTime: { gt: start },
        },
        include: {
          user: {
            select: {
              name: true,
              department: { select: { name: true } },
            },
          },
        },
      });

      if (conflictingBooking) {
        const bookerDept = conflictingBooking.user?.department?.name || resource.department?.name || 'Another Department';
        const confStart = formatTime(conflictingBooking.startDateTime);
        const confEnd = formatTime(conflictingBooking.endDateTime);
        const who = `${conflictingBooking.user?.name || 'another user'} (${bookerDept})`;
        const when = `${to12(confStart)} - ${to12(confEnd)}`;
        const msg =
          conflictingBooking.status === BookingStatus.APPROVED
            ? `Already booked by ${who}, ${when}.`
            : conflictingBooking.status === BookingStatus.PENDING
              ? `Already requested by ${who}, ${when} (waiting for approval).`
              : `This date and time is not available (${who}, ${when} - request was rejected).`;
        throw new ConflictError(
          msg,
          {
            conflictingBookingId: conflictingBooking.id,
            bookingCode: conflictingBooking.bookingCode,
            department: bookerDept,
          }
        );
      }

      // 8. Generate unique booking code
      const datePart = start.toISOString().slice(0, 10).replace(/-/g, '');
      const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      const bookingCode = `BK-${datePart}-${randomPart}`;

      // 9. No automatic approval: every booking waits for the Super Admin
      const needsApproval = true;
      const initialStatus = BookingStatus.PENDING;

      const createdBooking = await tx.booking.create({
        data: {
          bookingCode,
          resourceId: resource.id,
          userId,
          startDateTime: start,
          endDateTime: end,
          purpose: input.purpose,
          attendeesCount: input.attendeesCount || 1,
          specialRequirements: input.specialRequirements,
          status: initialStatus,
          isAutoApproved: !needsApproval,
          approvedById: !needsApproval ? userId : null,
        },
        include: {
          resource: {
            select: { id: true, name: true, code: true, departmentId: true },
          },
          user: {
            select: { id: true, name: true, email: true, collegeId: true },
          },
        },
      });

      // Record initial status in history
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: createdBooking.id,
          fromStatus: null,
          toStatus: initialStatus,
          changedById: userId,
          reason: needsApproval
            ? 'Booking request submitted and awaiting approval'
            : 'Booking approved',
        },
      });

      return createdBooking;
    });

    // Notify user
    await NotificationService.createNotification({
      userId,
      title: newBooking.status === BookingStatus.APPROVED ? 'Booking Confirmed!' : 'Booking Request Submitted',
      message: `Your booking for ${newBooking.resource.name} on ${newBooking.startDateTime.toDateString()} has been ${newBooking.status.toLowerCase()}. Code: ${newBooking.bookingCode}`,
      type: newBooking.status === BookingStatus.APPROVED ? NotificationType.BOOKING_APPROVED : NotificationType.BOOKING_SUBMITTED,
      bookingId: newBooking.id,
      link: `/bookings/${newBooking.id}`,
    });

    // Notify Department Coordinators if pending
    if (newBooking.status === BookingStatus.PENDING) {
      const coordinators = await prisma.user.findMany({
        where: { role: Role.SUPER_ADMIN, isActive: true },
        select: { id: true },
      });

      for (const coord of coordinators) {
        await NotificationService.createNotification({
          userId: coord.id,
          title: 'New Booking Approval Request',
          message: `${newBooking.user.name} submitted a reservation request for ${newBooking.resource.name}.`,
          type: NotificationType.BOOKING_SUBMITTED,
          bookingId: newBooking.id,
          link: `/bookings/${newBooking.id}`,
        });
      }
    }

    // Record audit log
    await AuditService.recordLog({
      userId,
      userEmail,
      action: 'CREATE_BOOKING',
      entityType: 'Booking',
      entityId: newBooking.id,
      details: {
        bookingCode: newBooking.bookingCode,
        resourceId: newBooking.resourceId,
        status: newBooking.status,
      },
      ipAddress,
    });

    return newBooking;
  }

  static async listBookings(query: {
    status?: BookingStatus;
    departmentId?: string;
    resourceId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
  }, actorUser: { id: string; role: Role; departmentId?: string | null }) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 500, 1000);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.status) where.status = query.status;
    if (query.resourceId) where.resourceId = query.resourceId;

    if (query.search) {
      where.OR = [
        { bookingCode: { contains: query.search, mode: 'insensitive' } },
        { purpose: { contains: query.search, mode: 'insensitive' } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { resource: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    if (query.startDate || query.endDate) {
      where.startDateTime = {};
      if (query.startDate) where.startDateTime.gte = new Date(query.startDate);
      if (query.endDate) where.startDateTime.lte = new Date(query.endDate);
    }

    // Role-based visibility scoping
    if (actorUser.role === Role.STUDENT) {
      // Students only see their own bookings
      where.userId = actorUser.id;
    } else if (actorUser.role === Role.COORDINATOR) {
      // Coordinator sees bookings within their department(s)
      const user = await prisma.user.findUnique({
        where: { id: actorUser.id },
        include: { memberships: true },
      });
      const deptIds = [
        user?.departmentId,
        ...(user?.memberships.map((m) => m.departmentId) || []),
      ].filter(Boolean) as string[];

      const scope: any[] = [{ resource: { departmentId: { in: deptIds } } }, { userId: actorUser.id }];
      if (query.departmentId && deptIds.includes(query.departmentId)) {
        scope[0] = { resource: { departmentId: query.departmentId } };
      }
      // keep any search OR filter intact by AND-ing the visibility scope
      where.AND = [...(where.AND || []), { OR: scope }];
    } else if (actorUser.role === Role.WEBSITE_ADMIN || actorUser.role === Role.SUPER_ADMIN) {
      if (query.departmentId) {
        where.resource = { departmentId: query.departmentId };
      }
      if (query.userId) {
        where.userId = query.userId;
      }
    }

    const [total, bookings] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        orderBy: { startDateTime: 'desc' },
        skip,
        take: limit,
        include: {
          resource: {
            select: {
              id: true,
              name: true,
              code: true,
              type: true,
              building: true,
              roomNumber: true,
              department: { select: { id: true, name: true, code: true } },
            },
          },
          user: {
            select: { id: true, name: true, email: true, collegeId: true },
          },
          approvedBy: {
            select: { id: true, name: true },
          },
        },
      }),
    ]);

    return {
      bookings,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getBookingById(id: string, actorId: string, actorRole: Role) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        resource: {
          include: {
            department: { select: { id: true, name: true, code: true } },
          },
        },
        user: {
          select: { id: true, name: true, email: true, collegeId: true, phone: true },
        },
        approvedBy: {
          select: { id: true, name: true, email: true },
        },
        statusHistory: {
          include: {
            changedBy: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!booking) {
      throw new NotFoundError('Booking record not found');
    }

    // Role check
    if (actorRole === Role.STUDENT && booking.userId !== actorId) {
      throw new ForbiddenError('You can only view your own bookings');
    }

    if (actorRole === Role.COORDINATOR) {
      const hasAccess = await checkDepartmentAccess(actorId, actorRole, booking.resource.departmentId);
      if (!hasAccess && booking.userId !== actorId) {
        throw new ForbiddenError('You do not have access to bookings for this department');
      }
    }

    return booking;
  }

  static async approveBooking(
    id: string,
    input: ApproveBookingInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { resource: true, user: true },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestError(`Cannot approve booking that is currently ${booking.status}`);
    }

    const hasAccess = await checkDepartmentAccess(actorId, actorRole, booking.resource.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You are not authorized to approve bookings for this department');
    }

    // Check if another approved booking took the slot in the meantime
    const conflicting = await prisma.booking.findFirst({
      where: {
        id: { not: booking.id },
        resourceId: booking.resourceId,
        status: BookingStatus.APPROVED,
        startDateTime: { lt: booking.endDateTime },
        endDateTime: { gt: booking.startDateTime },
      },
    });

    if (conflicting) {
      throw new ConflictError(
        'Cannot approve: Another booking was already approved for this time slot',
        { conflictingBookingId: conflicting.id }
      );
    }

    const updated = await prisma.$transaction([
      prisma.booking.update({
        where: { id },
        data: {
          status: BookingStatus.APPROVED,
          approvedById: actorId,
        },
        include: { resource: true, user: true },
      }),
      prisma.bookingStatusHistory.create({
        data: {
          bookingId: id,
          fromStatus: BookingStatus.PENDING,
          toStatus: BookingStatus.APPROVED,
          changedById: actorId,
          reason: input.notes || 'Approved by coordinator/administrator',
        },
      }),
    ]);

    // Send notification to the student
    await NotificationService.createNotification({
      userId: booking.userId,
      title: 'Booking Approved!',
      message: `Your booking for ${booking.resource.name} on ${booking.startDateTime.toDateString()} has been APPROVED!`,
      type: NotificationType.BOOKING_APPROVED,
      bookingId: booking.id,
      link: `/bookings/${booking.id}`,
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'APPROVE_BOOKING',
      entityType: 'Booking',
      entityId: id,
      details: { notes: input.notes },
    });

    return updated[0];
  }

  static async rejectBooking(
    id: string,
    input: RejectBookingInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { resource: true },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestError(`Cannot reject booking that is currently ${booking.status}`);
    }

    const hasAccess = await checkDepartmentAccess(actorId, actorRole, booking.resource.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You are not authorized to reject bookings for this department');
    }

    const updated = await prisma.$transaction([
      prisma.booking.update({
        where: { id },
        data: {
          status: BookingStatus.REJECTED,
          rejectionReason: input.reason,
          approvedById: actorId,
        },
        include: { resource: true },
      }),
      prisma.bookingStatusHistory.create({
        data: {
          bookingId: id,
          fromStatus: BookingStatus.PENDING,
          toStatus: BookingStatus.REJECTED,
          changedById: actorId,
          reason: input.reason,
        },
      }),
    ]);

    // Send notification
    await NotificationService.createNotification({
      userId: booking.userId,
      title: 'Booking Request Rejected',
      message: `Your booking for ${booking.resource.name} was rejected. Reason: ${input.reason}`,
      type: NotificationType.BOOKING_REJECTED,
      bookingId: booking.id,
      link: `/bookings/${booking.id}`,
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'REJECT_BOOKING',
      entityType: 'Booking',
      entityId: id,
      details: { reason: input.reason },
    });

    return updated[0];
  }

  static async cancelBooking(
    id: string,
    input: CancelBookingInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { resource: true },
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    if (([BookingStatus.CANCELLED, BookingStatus.REJECTED, BookingStatus.COMPLETED] as BookingStatus[]).includes(booking.status)) {
      throw new BadRequestError(`Cannot cancel a booking that is already ${booking.status}`);
    }

    // Student can only cancel their own booking
    if (actorRole === Role.STUDENT && booking.userId !== actorId) {
      throw new ForbiddenError('You can only cancel your own bookings');
    }

    // Coordinators can view their department's bookings but only act on their own
    if (actorRole === Role.COORDINATOR && booking.userId !== actorId) {
      throw new ForbiddenError('Coordinators can only cancel their own bookings');
    }

    const updated = await prisma.$transaction([
      prisma.booking.update({
        where: { id },
        data: {
          status: BookingStatus.CANCELLED,
          cancellationReason: input.reason,
        },
        include: { resource: true },
      }),
      prisma.bookingStatusHistory.create({
        data: {
          bookingId: id,
          fromStatus: booking.status,
          toStatus: BookingStatus.CANCELLED,
          changedById: actorId,
          reason: input.reason,
        },
      }),
    ]);

    // Send notification
    await NotificationService.createNotification({
      userId: booking.userId,
      title: 'Booking Cancelled',
      message: `Your booking for ${booking.resource.name} (${booking.bookingCode}) was cancelled. Reason: ${input.reason}`,
      type: NotificationType.BOOKING_CANCELLED,
      bookingId: booking.id,
      link: `/bookings/${booking.id}`,
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CANCEL_BOOKING',
      entityType: 'Booking',
      entityId: id,
      details: { reason: input.reason },
    });

    return updated[0];
  }
}
