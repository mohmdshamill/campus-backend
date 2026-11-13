import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { prisma } from '../config/db';

export const requireRole = (...roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Please authenticate first.'));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Access restricted: requires one of [${roles.join(', ')}] role(s).`
        )
      );
    }

    next();
  };
};

/** Website Admin = the person who created/maintains the website (admin console). */
export const requireWebsiteAdmin = requireRole(Role.WEBSITE_ADMIN);
/** Super Admin = whole-campus access; Website Admin = admin console. */
export const requireSuperAdmin = requireRole(Role.SUPER_ADMIN);
export const requireAdmin = requireRole(Role.SUPER_ADMIN, Role.WEBSITE_ADMIN);
export const requireCoordinatorOrAdmin = requireRole(Role.SUPER_ADMIN, Role.WEBSITE_ADMIN, Role.COORDINATOR);

/** Website Admin only uses the admin console, not the day-to-day campus modules. */
export const denyWebsiteAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user?.role === Role.WEBSITE_ADMIN) {
    return next(new ForbiddenError('Website Admin cannot access this section.'));
  }
  next();
};

/**
 * Check if the user has access to a specific department.
 * Super Admin and Website Admin have access to all departments.
 * Coordinator has access to their assigned department or memberships.
 */
export const checkDepartmentAccess = async (
  userId: string,
  userRole: Role,
  departmentId: string
): Promise<boolean> => {
  if (userRole === Role.SUPER_ADMIN || userRole === Role.WEBSITE_ADMIN) return true;

  if (userRole !== Role.COORDINATOR) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      departmentId: true,
      memberships: {
        select: { departmentId: true },
      },
    },
  });

  if (!user) return false;

  if (user.departmentId === departmentId) return true;

  const hasMembership = user.memberships.some((m) => m.departmentId === departmentId);
  return hasMembership;
};
