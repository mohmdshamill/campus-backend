import { prisma } from '../../config/db';
import { BadRequestError, NotFoundError, ConflictError } from '../../utils/errors';
import { CreateCollegeEventInput, UpdateCollegeEventInput } from './events.dto';
import { AuditService } from '../audit-logs/audit.service';
import { DayOfWeek, ResourceMaintenanceStatus, BookingStatus, MaintenanceStatus } from '@prisma/client';

// Venues where college events may be held
const EVENT_VENUE_CODES = ['AUD-MAIN-01', 'OPEN-MAIN-01', 'SEM-MAIN-01'];

export class EventService {
  static async listEvents(query: {
    resourceId?: string;
    eventType?: string;
    isUpcoming?: string;
    search?: string;
  }) {
    const where: any = { isCancelled: false };
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.eventType) where.eventType = query.eventType;
    if (query.isUpcoming === 'true') {
      where.endDateTime = { gte: new Date() };
    }
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { organizer: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return prisma.collegeEvent.findMany({
      where,
      orderBy: { startDateTime: 'asc' },
      include: {
        resource: {
          select: { id: true, name: true, code: true, building: true, roomNumber: true },
        },
      },
    });
  }

  static async getEventById(id: string) {
    const event = await prisma.collegeEvent.findUnique({
      where: { id },
      include: { resource: true },
    });

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    return event;
  }

  private static async validateEventConflicts(
    resourceId: string,
    start: Date,
    end: Date,
    excludeEventId?: string
  ) {
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestError('Invalid start or end date format');
    }

    if (start >= end) {
      throw new BadRequestError('Start time must be before end time');
    }

    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      include: { department: true },
    });

    if (!resource) {
      throw new NotFoundError('Venue resource not found');
    }

    if (!EVENT_VENUE_CODES.includes(resource.code)) {
      throw new BadRequestError(
        'College events can only be held at the Main Auditorium, College Open Area or Main Seminar Hall'
      );
    }

    if (!resource.isActive) {
      throw new BadRequestError('This venue is currently deactivated');
    }

    if (resource.maintenanceStatus === ResourceMaintenanceStatus.UNDER_MAINTENANCE) {
      throw new BadRequestError(
        `This venue is currently under maintenance (${resource.name}). Cannot schedule events.`
      );
    }

    const timeZone = process.env.COLLEGE_TIMEZONE || 'Asia/Kolkata';

    const formatTime = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);

    const formatDate = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d);

    const to12 = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    };

    const startHHMM = formatTime(start);
    const endHHMM = formatTime(end);

    // 1. Check conflict with Academic Class Timetable Schedules
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
    }).format(start).toUpperCase() as DayOfWeek;

    const academicClasses = await prisma.academicSchedule.findMany({
      where: {
        resourceId: resource.id,
        dayOfWeek: dayName,
        isActive: true,
      },
      include: { department: true },
    });

    for (const cls of academicClasses) {
      if (startHHMM < cls.endTime && endHHMM > cls.startTime) {
        const deptName = cls.department?.name || resource.department?.name || 'Academic Department';
        throw new ConflictError(
          `Already booked: ${cls.courseName} (${cls.courseCode}) for ${deptName}, ${to12(cls.startTime)} - ${to12(cls.endTime)}.`,
          { classId: cls.id, course: cls.courseName, department: deptName }
        );
      }
    }

    // 1b. Venue must not be under scheduled maintenance during this interval
    const conflictingMaintenance = await prisma.maintenanceRecord.findFirst({
      where: {
        resourceId: resource.id,
        status: { in: [MaintenanceStatus.REPORTED, MaintenanceStatus.IN_PROGRESS] },
        startDateTime: { lt: end },
        endDateTime: { gt: start },
      },
    });
    if (conflictingMaintenance) {
      throw new ConflictError(
        `Venue is under maintenance on ${formatDate(conflictingMaintenance.startDateTime)}, ${to12(formatTime(conflictingMaintenance.startDateTime))} - ${to12(formatTime(conflictingMaintenance.endDateTime))}: "${conflictingMaintenance.title}". Events cannot be scheduled then.`,
        { maintenanceId: conflictingMaintenance.id }
      );
    }

    // 2. Check conflict with other College Events on the same resource
    const conflictingEvent = await prisma.collegeEvent.findFirst({
      where: {
        resourceId: resource.id,
        isCancelled: false,
        ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
        startDateTime: { lt: end },
        endDateTime: { gt: start },
      },
    });

    if (conflictingEvent) {
      const confStart = formatTime(conflictingEvent.startDateTime);
      const confEnd = formatTime(conflictingEvent.endDateTime);
      const confDate = formatDate(conflictingEvent.startDateTime);
      const eventOrganizer = conflictingEvent.organizer || 'Another Department';

      throw new ConflictError(
        `Already booked by ${eventOrganizer} for event "${conflictingEvent.title}" on ${confDate}, ${to12(confStart)} - ${to12(confEnd)}.`,
        {
          conflictingEventId: conflictingEvent.id,
          organizer: conflictingEvent.organizer,
          title: conflictingEvent.title,
        }
      );
    }

    // 3. Check conflict with Bookings (APPROVED or PENDING) on the same resource
    const conflictingBooking = await prisma.booking.findFirst({
      where: {
        resourceId: resource.id,
        status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
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
      const bookerDept = conflictingBooking.user.department?.name || resource.department?.name || 'Another Department';
      const confStart = formatTime(conflictingBooking.startDateTime);
      const confEnd = formatTime(conflictingBooking.endDateTime);
      const confDate = formatDate(conflictingBooking.startDateTime);

      throw new ConflictError(
        `Already booked by ${conflictingBooking.user.name} (${bookerDept}) on ${confDate}, ${to12(confStart)} - ${to12(confEnd)}.`,
        {
          conflictingBookingId: conflictingBooking.id,
          bookingCode: conflictingBooking.bookingCode,
          department: bookerDept,
        }
      );
    }

    return resource;
  }

  static async createEvent(
    input: CreateCollegeEventInput,
    actorId: string,
    actorEmail: string
  ) {
    const start = new Date(input.startDateTime);
    const end = new Date(input.endDateTime);

    const resource = await this.validateEventConflicts(input.resourceId, start, end);

    const event = await prisma.collegeEvent.create({
      data: input,
      include: { resource: true },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CREATE_COLLEGE_EVENT',
      entityType: 'CollegeEvent',
      entityId: event.id,
      details: { title: event.title, resource: resource.name },
    });

    return event;
  }

  static async updateEvent(
    id: string,
    input: UpdateCollegeEventInput,
    actorId: string,
    actorEmail: string
  ) {
    const current = await this.getEventById(id);
    const start = input.startDateTime ? new Date(input.startDateTime) : current.startDateTime;
    const end = input.endDateTime ? new Date(input.endDateTime) : current.endDateTime;
    const resourceId = input.resourceId || current.resourceId;

    const resource = await this.validateEventConflicts(resourceId, start, end, id);

    const updated = await prisma.collegeEvent.update({
      where: { id },
      data: input,
      include: { resource: true },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'UPDATE_COLLEGE_EVENT',
      entityType: 'CollegeEvent',
      entityId: id,
      details: input,
    });

    return updated;
  }

  static async cancelEvent(
    id: string,
    actorId: string,
    actorEmail: string
  ) {
    await this.getEventById(id);

    const cancelled = await prisma.collegeEvent.update({
      where: { id },
      data: { isCancelled: true },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CANCEL_COLLEGE_EVENT',
      entityType: 'CollegeEvent',
      entityId: id,
    });

    return cancelled;
  }
}
