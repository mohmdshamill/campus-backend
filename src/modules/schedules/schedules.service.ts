import { prisma } from '../../config/db';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors';
import {
  CreateAcademicScheduleInput,
  UpdateAcademicScheduleInput,
} from './schedules.dto';
import { AuditService } from '../audit-logs/audit.service';
import { BookingStatus, DayOfWeek, Role } from '@prisma/client';
import { checkDepartmentAccess } from '../../middleware/role.middleware';

const to12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

export class ScheduleService {
  static async listSchedules(query: {
    departmentId?: string;
    resourceId?: string;
    dayOfWeek?: DayOfWeek;
    semester?: string;
    academicYear?: string;
    isActive?: string;
  }) {
    const where: any = {};
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.dayOfWeek) where.dayOfWeek = query.dayOfWeek;
    if (query.semester) where.semester = query.semester;
    if (query.academicYear) where.academicYear = query.academicYear;
    if (query.isActive !== undefined && query.isActive !== '') {
      where.isActive = query.isActive === 'true';
    }

    return prisma.academicSchedule.findMany({
      where,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      include: {
        resource: {
          select: { id: true, name: true, code: true, building: true, roomNumber: true },
        },
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });
  }

  static async getScheduleById(id: string) {
    const schedule = await prisma.academicSchedule.findUnique({
      where: { id },
      include: {
        resource: true,
        department: true,
      },
    });

    if (!schedule) {
      throw new NotFoundError('Academic schedule entry not found');
    }

    return schedule;
  }

  static async createSchedule(
    input: CreateAcademicScheduleInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const hasAccess = await checkDepartmentAccess(actorId, actorRole, input.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You are not authorized to create schedules for this department');
    }

    if (input.startTime >= input.endTime) {
      throw new BadRequestError('Start time must be before end time');
    }

    // Check conflict with other timetable classes on same resource & day
    const existing = await prisma.academicSchedule.findFirst({
      where: {
        resourceId: input.resourceId,
        dayOfWeek: input.dayOfWeek,
        isActive: true,
        startTime: { lt: input.endTime },
        endTime: { gt: input.startTime },
      },
    });

    if (existing) {
      throw new ConflictError(
        `Already booked: ${existing.courseName} (${existing.courseCode}) is scheduled ${to12(existing.startTime)} - ${to12(existing.endTime)} on this day.`
      );
    }

    // Check affected upcoming bookings (to warn or notify)
    const affectedBookings = await prisma.booking.findMany({
      where: {
        resourceId: input.resourceId,
        status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
        startDateTime: { gte: new Date() },
      },
      include: { user: { select: { name: true, email: true } } },
    });

    const schedule = await prisma.academicSchedule.create({
      data: input,
      include: {
        resource: true,
        department: true,
      },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CREATE_ACADEMIC_SCHEDULE',
      entityType: 'AcademicSchedule',
      entityId: schedule.id,
      details: {
        courseCode: schedule.courseCode,
        day: schedule.dayOfWeek,
        affectedBookingsCount: affectedBookings.length,
      },
    });

    return { schedule, affectedBookings };
  }

  static async updateSchedule(
    id: string,
    input: UpdateAcademicScheduleInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const schedule = await this.getScheduleById(id);

    const hasAccess = await checkDepartmentAccess(actorId, actorRole, schedule.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You are not authorized to modify schedules for this department');
    }

    const updated = await prisma.academicSchedule.update({
      where: { id },
      data: input,
      include: { resource: true, department: true },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'UPDATE_ACADEMIC_SCHEDULE',
      entityType: 'AcademicSchedule',
      entityId: id,
      details: input,
    });

    return updated;
  }

  static async deleteSchedule(
    id: string,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const schedule = await this.getScheduleById(id);

    const hasAccess = await checkDepartmentAccess(actorId, actorRole, schedule.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You are not authorized to delete schedules for this department');
    }

    await prisma.academicSchedule.delete({ where: { id } });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'DELETE_ACADEMIC_SCHEDULE',
      entityType: 'AcademicSchedule',
      entityId: id,
    });

    return { message: 'Schedule entry deleted successfully' };
  }
}
