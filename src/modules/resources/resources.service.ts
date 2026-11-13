import { prisma } from '../../config/db';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors';
import { CreateResourceInput, UpdateResourceInput } from './resources.dto';
import { AuditService } from '../audit-logs/audit.service';
import {
  BookingStatus,
  DayOfWeek,
  MaintenanceStatus,
  ResourceMaintenanceStatus,
  ResourceType,
  Role,
} from '@prisma/client';
import { checkDepartmentAccess } from '../../middleware/role.middleware';

export class ResourceService {
  static async listResources(query: {
    search?: string;
    departmentId?: string;
    type?: ResourceType;
    minCapacity?: number;
    isActive?: string;
    maintenanceStatus?: ResourceMaintenanceStatus;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { building: { contains: query.search, mode: 'insensitive' } },
        { roomNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.type) where.type = query.type;
    if (query.minCapacity) where.capacity = { gte: Number(query.minCapacity) };
    if (query.maintenanceStatus) where.maintenanceStatus = query.maintenanceStatus;

    if (query.isActive !== undefined && query.isActive !== '') {
      where.isActive = query.isActive === 'true';
    }

    const [total, resources] = await Promise.all([
      prisma.resource.count({ where }),
      prisma.resource.findMany({
        where,
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
        include: {
          department: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: {
              bookings: true,
              academicSchedules: true,
              maintenanceRecords: true,
            },
          },
        },
      }),
    ]);

    return {
      resources,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getResourceById(id: string) {
    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
        academicSchedules: {
          where: { isActive: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
        maintenanceRecords: {
          where: { status: { in: [MaintenanceStatus.REPORTED, MaintenanceStatus.IN_PROGRESS] } },
          orderBy: { startDateTime: 'asc' },
        },
      },
    });

    if (!resource) {
      throw new NotFoundError('Resource not found');
    }

    return resource;
  }

  static async createResource(
    input: CreateResourceInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    // Check department access
    const hasAccess = await checkDepartmentAccess(actorId, actorRole, input.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to add resources to this department');
    }

    const existingCode = await prisma.resource.findUnique({
      where: { code: input.code.toUpperCase() },
    });
    if (existingCode) {
      throw new ConflictError(`Resource code ${input.code} already exists`);
    }

    const resource = await prisma.resource.create({
      data: {
        ...input,
        code: input.code.toUpperCase(),
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
      },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CREATE_RESOURCE',
      entityType: 'Resource',
      entityId: resource.id,
      details: input,
    });

    return resource;
  }

  static async updateResource(
    id: string,
    input: UpdateResourceInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const resource = await this.getResourceById(id);

    // Check department access
    const hasAccess = await checkDepartmentAccess(actorId, actorRole, resource.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to manage this resource');
    }

    if (input.departmentId && input.departmentId !== resource.departmentId) {
      const hasNewDeptAccess = await checkDepartmentAccess(actorId, actorRole, input.departmentId);
      if (!hasNewDeptAccess) {
        throw new ForbiddenError('You do not have permission to move resource to the destination department');
      }
    }

    if (input.code) {
      const existing = await prisma.resource.findFirst({
        where: {
          code: input.code.toUpperCase(),
          NOT: { id },
        },
      });
      if (existing) {
        throw new ConflictError(`Resource code ${input.code} is already in use`);
      }
    }

    const updated = await prisma.resource.update({
      where: { id },
      data: {
        ...input,
        code: input.code ? input.code.toUpperCase() : undefined,
      },
      include: {
        department: { select: { id: true, name: true, code: true } },
      },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'UPDATE_RESOURCE',
      entityType: 'Resource',
      entityId: id,
      details: input,
    });

    return updated;
  }

  static async deleteOrDeactivate(
    id: string,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const resource = await this.getResourceById(id);

    const hasAccess = await checkDepartmentAccess(actorId, actorRole, resource.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to modify this resource');
    }

    // Check if historical bookings exist. Per requirement:
    // "Do not permanently delete resources that are referenced by historical bookings. Use soft deletion or deactivation where appropriate."
    const bookingsCount = await prisma.booking.count({ where: { resourceId: id } });

    if (bookingsCount > 0) {
      const deactivated = await prisma.resource.update({
        where: { id },
        data: { isActive: false },
      });

      await AuditService.recordLog({
        userId: actorId,
        userEmail: actorEmail,
        action: 'DEACTIVATE_RESOURCE',
        entityType: 'Resource',
        entityId: id,
        details: { reason: 'Has historical bookings, deactivated instead of hard delete' },
      });

      return {
        message: 'Resource has historical bookings and was safely deactivated instead of deleted.',
        resource: deactivated,
      };
    }

    await prisma.resource.delete({ where: { id } });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'DELETE_RESOURCE',
      entityType: 'Resource',
      entityId: id,
    });

    return { message: 'Resource permanently deleted successfully' };
  }

  /**
   * Smart Availability Engine
   * Returns availability slots, academic classes, maintenance blocks, and existing bookings
   * for a specific resource on a given date (YYYY-MM-DD).
   */
  static async getResourceAvailability(resourceId: string, dateStr: string) {
    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      include: { department: true },
    });

    if (!resource) {
      throw new NotFoundError('Resource not found');
    }

    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
    if (isNaN(targetDate.getTime())) {
      throw new BadRequestError('Invalid date format. Expected YYYY-MM-DD');
    }

    // Convert date to day of week
    const daysMap: DayOfWeek[] = [
      DayOfWeek.SUNDAY,
      DayOfWeek.MONDAY,
      DayOfWeek.TUESDAY,
      DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY,
      DayOfWeek.FRIDAY,
      DayOfWeek.SATURDAY,
    ];
    const dayOfWeek = daysMap[targetDate.getUTCDay()];

    // Day boundaries
    // Day boundaries in college time (IST, +05:30)
    const dayStart = new Date(`${dateStr}T00:00:00+05:30`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999+05:30`);

    // 1. Fetch academic class timetable for this day
    const academicSchedules = await prisma.academicSchedule.findMany({
      where: {
        resourceId,
        dayOfWeek,
        isActive: true,
      },
      orderBy: { startTime: 'asc' },
    });

    // 2. Fetch existing bookings on this date (APPROVED or PENDING)
    const bookings = await prisma.booking.findMany({
      where: {
        resourceId,
        status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
      },
      include: {
        user: { select: { id: true, name: true, collegeId: true } },
      },
      orderBy: { startDateTime: 'asc' },
    });

    // 3. Fetch college events on this date
    const events = await prisma.collegeEvent.findMany({
      where: {
        resourceId,
        isCancelled: false,
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
      },
      orderBy: { startDateTime: 'asc' },
    });

    // 4. Fetch maintenance blocks on this date
    const maintenance = await prisma.maintenanceRecord.findMany({
      where: {
        resourceId,
        status: { in: [MaintenanceStatus.REPORTED, MaintenanceStatus.IN_PROGRESS] },
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
      },
      orderBy: { startDateTime: 'asc' },
    });

    // Map busy intervals
    const busyIntervals: Array<{
      start: string; // HH:mm or ISO
      end: string;
      type: 'BOOKING' | 'ACADEMIC_CLASS' | 'COLLEGE_EVENT' | 'MAINTENANCE';
      title: string;
      status?: string;
      id?: string;
    }> = [];

    // Add classes
    academicSchedules.forEach((item) => {
      busyIntervals.push({
        start: new Date(`${dateStr}T${item.startTime}:00+05:30`).toISOString(),
        end: new Date(`${dateStr}T${item.endTime}:00+05:30`).toISOString(),
        type: 'ACADEMIC_CLASS',
        title: `${item.courseCode} - ${item.courseName} (${item.instructorName})`,
        id: item.id,
      });
    });

    // Add bookings
    bookings.forEach((b) => {
      busyIntervals.push({
        start: b.startDateTime.toISOString(),
        end: b.endDateTime.toISOString(),
        type: 'BOOKING',
        title: `${b.purpose} (${b.user.name})`,
        status: b.status,
        id: b.id,
      });
    });

    // Add events
    events.forEach((ev) => {
      busyIntervals.push({
        start: ev.startDateTime.toISOString(),
        end: ev.endDateTime.toISOString(),
        type: 'COLLEGE_EVENT',
        title: `${ev.title} (${ev.eventType})`,
        id: ev.id,
      });
    });

    // Add maintenance
    maintenance.forEach((m) => {
      busyIntervals.push({
        start: m.startDateTime.toISOString(),
        end: m.endDateTime.toISOString(),
        type: 'MAINTENANCE',
        title: `Maintenance: ${m.title}`,
        status: m.status,
        id: m.id,
      });
    });

    return {
      resource: {
        id: resource.id,
        name: resource.name,
        code: resource.code,
        type: resource.type,
        capacity: resource.capacity,
        operatingHoursStart: resource.operatingHoursStart,
        operatingHoursEnd: resource.operatingHoursEnd,
        minBookingMinutes: resource.minBookingMinutes,
        maxBookingMinutes: resource.maxBookingMinutes,
        minAdvanceDays: resource.minAdvanceDays,
        maxAdvanceDays: resource.maxAdvanceDays,
        requiresApproval: resource.requiresApproval,
        isActive: resource.isActive,
        maintenanceStatus: resource.maintenanceStatus,
      },
      date: dateStr,
      dayOfWeek,
      busyIntervals,
      academicSchedules,
      bookings,
      events,
      maintenance,
    };
  }
}
