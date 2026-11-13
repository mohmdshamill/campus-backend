import { prisma } from '../../config/db';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { AuditService } from '../audit-logs/audit.service';

const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.WEBSITE_ADMIN];

/** Only the Website Admin may create or assign Super Admin / Website Admin roles. */
const assertCanAssignRole = (role: Role | undefined, actorRole?: Role) => {
  if (role && ADMIN_ROLES.includes(role) && actorRole !== Role.WEBSITE_ADMIN) {
    throw new ForbiddenError('Only the Website Admin can assign administrator roles');
  }
};

export const CreateUserDto = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: z.string().trim().email('Valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.nativeEnum(Role),
  collegeId: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
});
export type CreateUserInput = z.infer<typeof CreateUserDto>;

export class UserService {
  /** Super-admin only (enforced by the route): create a user with any role. */
  static async createUser(input: CreateUserInput, actorId?: string, actorEmail?: string, actorRole?: Role) {
    assertCanAssignRole(input.role, actorRole);
    const email = input.email.toLowerCase();
    const collegeId = input.collegeId || null;

    if (!ADMIN_ROLES.includes(input.role) && !input.departmentId) {
      throw new BadRequestError('Department is required for students and coordinators');
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      throw new ConflictError('A user with this email already exists');
    }
    if (collegeId && (await prisma.user.findUnique({ where: { collegeId } }))) {
      throw new ConflictError('A user with this College ID already exists');
    }
    if (input.departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
      if (!dept) throw new NotFoundError('Department not found');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const created = await prisma.user.create({
      data: {
        name: input.name,
        email,
        passwordHash,
        role: input.role,
        collegeId,
        phone: input.phone || null,
        departmentId: ADMIN_ROLES.includes(input.role) ? null : input.departmentId,
        isActive: true,
        ...(input.role === Role.COORDINATOR && input.departmentId
          ? {
              memberships: {
                create: { departmentId: input.departmentId, roleInDept: 'COORDINATOR', isPrimary: true },
              },
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        collegeId: true,
        phone: true,
        departmentId: true,
        isActive: true,
        department: { select: { id: true, name: true, code: true } },
      },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CREATE_USER',
      entityType: 'User',
      entityId: created.id,
      details: { name: created.name, email: created.email, role: created.role },
    });

    return created;
  }

  static async listUsers(query: {
    search?: string;
    role?: Role;
    departmentId?: string;
    isActive?: string;
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
        { email: { contains: query.search, mode: 'insensitive' } },
        { collegeId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.role) where.role = query.role;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.isActive !== undefined && query.isActive !== '') {
      where.isActive = query.isActive === 'true';
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          collegeId: true,
          phone: true,
          departmentId: true,
          isActive: true,
          createdAt: true,
          department: {
            select: { id: true, name: true, code: true },
          },
          memberships: {
            select: {
              id: true,
              departmentId: true,
              roleInDept: true,
              department: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getUserById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        collegeId: true,
        phone: true,
        departmentId: true,
        isActive: true,
        createdAt: true,
        department: {
          select: { id: true, name: true, code: true },
        },
        memberships: {
          include: {
            department: { select: { id: true, name: true, code: true } },
          },
        },
        _count: {
          select: {
            bookings: true,
            equipmentTransactions: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  static async updateUser(
    id: string,
    data: {
      name?: string;
      role?: Role;
      departmentId?: string | null;
      isActive?: boolean;
      phone?: string | null;
    },
    actorId?: string,
    actorEmail?: string,
    actorRole?: Role
  ) {
    assertCanAssignRole(data.role, actorRole);
    const existingUser = await this.getUserById(id);
    // A coordinator/student must belong to a department, otherwise they cannot see any bookings
    const finalRole = data.role ?? existingUser.role;
    const finalDept = data.departmentId === undefined ? existingUser.departmentId : data.departmentId;
    if (!ADMIN_ROLES.includes(finalRole) && !finalDept) {
      throw new BadRequestError('Assign a department before making this user a coordinator or student');
    }
    if (ADMIN_ROLES.includes(existingUser.role) && actorRole !== Role.WEBSITE_ADMIN) {
      throw new ForbiddenError('Only the Website Admin can modify administrator accounts');
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        collegeId: true,
        phone: true,
        departmentId: true,
        isActive: true,
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'UPDATE_USER',
      entityType: 'User',
      entityId: id,
      details: data,
    });

    return updated;
  }
}
