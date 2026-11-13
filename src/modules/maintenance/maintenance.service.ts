import { prisma } from '../../config/db';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors';
import { CreateMaintenanceInput, UpdateMaintenanceInput } from './maintenance.dto';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationService } from '../notifications/notifications.service';
import {
  BookingStatus,
  MaintenanceStatus,
  NotificationType,
  ResourceMaintenanceStatus,
  ResourceType,
  Role,
} from '@prisma/client';
import { checkDepartmentAccess } from '../../middleware/role.middleware';

// Main campus areas that every coordinator can report maintenance for
const MAIN_AREA_TYPES: ResourceType[] = [
  ResourceType.AUDITORIUM,
  ResourceType.SEMINAR_HALL,
  ResourceType.MEETING_ROOM,
];

/** Coordinator may manage maintenance of own-department resources and the main areas. */
const canManageMaintenance = async (
  actorId: string,
  actorRole: Role,
  resource: { departmentId: string; type: ResourceType }
) =>
  MAIN_AREA_TYPES.includes(resource.type) ||
  (await checkDepartmentAccess(actorId, actorRole, resource.departmentId));

export class MaintenanceService {
  static async listMaintenance(actor: { id: string; role: Role }, query: {
    resourceId?: string;
    departmentId?: string;
    status?: MaintenanceStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 500, 1000);
    const skip = (page - 1) * limit;

    const where: any = {};
    const and: any[] = [];
    if (actor.role === Role.COORDINATOR) {
      // own department + main areas only; other departments are hidden
      const me = await prisma.user.findUnique({
        where: { id: actor.id },
        include: { memberships: true },
      });
      const deptIds = [me?.departmentId, ...(me?.memberships.map((m) => m.departmentId) || [])].filter(Boolean) as string[];
      and.push({
        OR: [
          { resource: { departmentId: { in: deptIds } } },
          { resource: { type: { in: MAIN_AREA_TYPES } } },
        ],
      });
    }
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.status) where.status = query.status;
    if (query.departmentId) where.resource = { departmentId: query.departmentId };

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { resource: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    if (and.length) where.AND = and;

    const [total, records] = await Promise.all([
      prisma.maintenanceRecord.count({ where }),
      prisma.maintenanceRecord.findMany({
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
          reportedBy: { select: { id: true, name: true, email: true } },
          resolvedBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      records,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getMaintenanceById(id: string) {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id },
      include: {
        resource: {
          include: { department: { select: { id: true, name: true, code: true } } },
        },
        reportedBy: { select: { id: true, name: true, email: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });

    if (!record) {
      throw new NotFoundError('Maintenance record not found');
    }

    // Also fetch any affected bookings overlapping this maintenance window
    const affectedBookings = await prisma.booking.findMany({
      where: {
        resourceId: record.resourceId,
        status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
        startDateTime: { lt: record.endDateTime },
        endDateTime: { gt: record.startDateTime },
      },
      include: {
        user: { select: { id: true, name: true, email: true, collegeId: true } },
      },
      orderBy: { startDateTime: 'asc' },
    });

    return { ...record, affectedBookings };
  }

  static async createMaintenance(
    input: CreateMaintenanceInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const resource = await prisma.resource.findUnique({
      where: { id: input.resourceId },
    });

    if (!resource) throw new NotFoundError('Resource not found');

    const hasAccess = await canManageMaintenance(actorId, actorRole, resource);
    if (!hasAccess) throw new ForbiddenError('You do not have access to schedule maintenance for this resource');

    // No dates given: maintenance starts now and blocks the venue until it is resolved
    const start = input.startDateTime ? new Date(input.startDateTime) : new Date();
    const end = input.endDateTime
      ? new Date(input.endDateTime)
      : new Date(start.getTime() + 5 * 365 * 24 * 60 * 60 * 1000);

    if (start >= end) {
      throw new BadRequestError('Start time must be before end time');
    }

    // Check affected bookings
    const affectedBookings = await prisma.booking.findMany({
      where: {
        resourceId: resource.id,
        status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
        startDateTime: { lt: end },
        endDateTime: { gt: start },
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.maintenanceRecord.create({
        data: {
          resourceId: input.resourceId,
          reportedById: actorId,
          title: input.title,
          description: input.description,
          startDateTime: start,
          endDateTime: end,
          priority: input.priority,
          status: MaintenanceStatus.REPORTED,
        },
        include: { resource: true },
      });

      if (input.blockResource) {
        await tx.resource.update({
          where: { id: input.resourceId },
          data: { maintenanceStatus: ResourceMaintenanceStatus.UNDER_MAINTENANCE },
        });
      }

      return created;
    });

    // Notify affected booking holders
    for (const b of affectedBookings) {
      await NotificationService.createNotification({
        userId: b.userId,
        title: 'Maintenance Alert: Reservation Impacted',
        message: `Maintenance scheduled on ${resource.name} (${input.title}) conflicts with your booking ${b.bookingCode}. Please review or reschedule.`,
        type: NotificationType.MAINTENANCE_ALERT,
        bookingId: b.id,
        link: `/bookings/${b.id}`,
      });
    }

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CREATE_MAINTENANCE',
      entityType: 'MaintenanceRecord',
      entityId: record.id,
      details: {
        resourceId: resource.id,
        affectedBookingsCount: affectedBookings.length,
      },
    });

    return { record, affectedBookings };
  }

  static async updateMaintenance(
    id: string,
    input: UpdateMaintenanceInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id },
      include: { resource: true },
    });

    if (!record) throw new NotFoundError('Maintenance record not found');

    const hasAccess = await canManageMaintenance(actorId, actorRole, record.resource);
    if (!hasAccess) throw new ForbiddenError('You do not have access to update this maintenance record');

    const updated = await prisma.$transaction(async (tx) => {
      const updatedRecord = await tx.maintenanceRecord.update({
        where: { id },
        data: {
          status: input.status,
          priority: input.priority,
          title: input.title,
          description: input.description,
          resolutionNotes: input.resolutionNotes,
          endDateTime: input.endDateTime
            ? new Date(input.endDateTime)
            : input.status === MaintenanceStatus.RESOLVED || input.status === MaintenanceStatus.CANCELLED
              ? new Date() // open-ended report closes when resolved
              : undefined,
          resolvedById:
            input.status === MaintenanceStatus.RESOLVED ? actorId : undefined,
        },
        include: { resource: true },
      });

      // If resolved or cancelled, check if any other active maintenance exists for this resource
      if (
        input.status === MaintenanceStatus.RESOLVED ||
        input.status === MaintenanceStatus.CANCELLED
      ) {
        const remainingActive = await tx.maintenanceRecord.count({
          where: {
            resourceId: record.resourceId,
            id: { not: id },
            status: { in: [MaintenanceStatus.REPORTED, MaintenanceStatus.IN_PROGRESS] },
          },
        });

        if (remainingActive === 0) {
          await tx.resource.update({
            where: { id: record.resourceId },
            data: { maintenanceStatus: ResourceMaintenanceStatus.OPERATIONAL },
          });
        }
      }

      return updatedRecord;
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'UPDATE_MAINTENANCE',
      entityType: 'MaintenanceRecord',
      entityId: id,
      details: input,
    });

    return updated;
  }
}
