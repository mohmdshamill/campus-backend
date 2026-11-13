import { prisma } from '../../config/db';
import { ConflictError, NotFoundError } from '../../utils/errors';
import {
  CreateDepartmentInput,
  UpdateDepartmentInput,
  AssignCoordinatorInput,
} from './departments.dto';
import { AuditService } from '../audit-logs/audit.service';
import { Role } from '@prisma/client';

export class DepartmentService {
  static async listDepartments(query: { search?: string; isActive?: string }) {
    const where: any = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.isActive !== undefined && query.isActive !== '') {
      where.isActive = query.isActive === 'true';
    }

    const departments = await prisma.department.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            resources: true,
            equipment: true,
            users: true,
          },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, collegeId: true },
            },
          },
        },
      },
    });

    return departments;
  }

  static async getDepartmentById(id: string) {
    const department = await prisma.department.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            resources: true,
            equipment: true,
            users: true,
          },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, collegeId: true },
            },
          },
        },
        resources: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!department) {
      throw new NotFoundError('Department not found');
    }

    return department;
  }

  static async createDepartment(
    input: CreateDepartmentInput,
    actorId?: string,
    actorEmail?: string
  ) {
    const existing = await prisma.department.findUnique({
      where: { code: input.code.toUpperCase() },
    });

    if (existing) {
      throw new ConflictError(`Department code ${input.code} already exists`);
    }

    const department = await prisma.department.create({
      data: {
        name: input.name,
        code: input.code.toUpperCase(),
        description: input.description,
        isActive: input.isActive ?? true,
      },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CREATE_DEPARTMENT',
      entityType: 'Department',
      entityId: department.id,
      details: department,
    });

    return department;
  }

  static async updateDepartment(
    id: string,
    input: UpdateDepartmentInput,
    actorId?: string,
    actorEmail?: string
  ) {
    await this.getDepartmentById(id);

    if (input.code) {
      const existing = await prisma.department.findFirst({
        where: {
          code: input.code.toUpperCase(),
          NOT: { id },
        },
      });
      if (existing) {
        throw new ConflictError(`Department code ${input.code} is already taken`);
      }
    }

    const updated = await prisma.department.update({
      where: { id },
      data: {
        ...input,
        code: input.code ? input.code.toUpperCase() : undefined,
      },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'UPDATE_DEPARTMENT',
      entityType: 'Department',
      entityId: updated.id,
      details: input,
    });

    return updated;
  }

  static async assignCoordinator(
    departmentId: string,
    input: AssignCoordinatorInput,
    actorId?: string,
    actorEmail?: string
  ) {
    await this.getDepartmentById(departmentId);

    // Make sure user is assigned COORDINATOR role if not website admin
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new NotFoundError('User not found');

    if (user.role === Role.STUDENT) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: Role.COORDINATOR, departmentId },
      });
    }

    const membership = await prisma.departmentMembership.upsert({
      where: {
        userId_departmentId: {
          userId: input.userId,
          departmentId,
        },
      },
      update: {
        roleInDept: input.roleInDept,
        isPrimary: input.isPrimary,
      },
      create: {
        userId: input.userId,
        departmentId,
        roleInDept: input.roleInDept,
        isPrimary: input.isPrimary,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'ASSIGN_COORDINATOR',
      entityType: 'Department',
      entityId: departmentId,
      details: { coordinatorId: input.userId, roleInDept: input.roleInDept },
    });

    return membership;
  }

  static async removeCoordinator(
    departmentId: string,
    userId: string,
    actorId?: string,
    actorEmail?: string
  ) {
    await prisma.departmentMembership.deleteMany({
      where: { departmentId, userId },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'REMOVE_COORDINATOR',
      entityType: 'Department',
      entityId: departmentId,
      details: { coordinatorId: userId },
    });

    return { message: 'Coordinator unassigned successfully' };
  }
}
