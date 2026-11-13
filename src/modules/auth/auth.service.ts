import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../../config/db';
import { generateToken } from '../../utils/jwt';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../../utils/errors';
import {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from './auth.dto';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationService } from '../notifications/notifications.service';
import { NotificationType, Role } from '@prisma/client';

export class AuthService {
  static async register(input: RegisterInput, ipAddress?: string) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictError('A user with this email address already exists');
    }

    if (input.collegeId) {
      const existingCollegeId = await prisma.user.findUnique({
        where: { collegeId: input.collegeId },
      });
      if (existingCollegeId) {
        throw new ConflictError('A user with this College/Roll ID already exists');
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.password, salt);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        role: input.role || Role.STUDENT,
        collegeId: input.collegeId,
        departmentId: input.departmentId,
        phone: input.phone,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        collegeId: true,
        departmentId: true,
        phone: true,
        createdAt: true,
        department: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Create welcome notification
    await NotificationService.createNotification({
      userId: user.id,
      title: 'Welcome to Campus Connect!',
      message: 'Your account has been registered successfully. Explore campus resources and submit booking requests anytime.',
      type: NotificationType.SYSTEM,
    });

    // Record audit log
    await AuditService.recordLog({
      userId: user.id,
      userEmail: user.email,
      action: 'USER_REGISTER',
      entityType: 'User',
      entityId: user.id,
      details: { role: user.role, email: user.email },
      ipAddress,
    });

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
    });

    return { user, token };
  }

  static async login(input: LoginInput, ipAddress?: string) {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
        memberships: {
          select: {
            id: true,
            departmentId: true,
            isPrimary: true,
            department: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is disabled. Please contact the administrator.');
    }

    const isMatch = await bcrypt.compare(input.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
    });

    await AuditService.recordLog({
      userId: user.id,
      userEmail: user.email,
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
    });

    const { passwordHash: _, ...userSafe } = user;
    return { user: userSafe, token };
  }

  static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        department: {
          select: { id: true, name: true, code: true },
        },
        memberships: {
          select: {
            id: true,
            departmentId: true,
            isPrimary: true,
            department: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User profile not found');
    }

    const { passwordHash: _, ...userSafe } = user;
    return userSafe;
  }

  static async forgotPassword(input: ForgotPasswordInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (!user) {
      // Return success anyway for security timing protection
      return { message: 'If this email exists, a password reset code has been generated.' };
    }

    // Invalidate existing active tokens
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    });

    // Create 6-character reset token or secure hash
    const resetToken = crypto.randomBytes(20).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt,
      },
    });

    await NotificationService.createNotification({
      userId: user.id,
      title: 'Password Reset Requested',
      message: `A password reset token was created for your account: ${resetToken}. It expires in 1 hour.`,
      type: NotificationType.SYSTEM,
    });

    return {
      message: 'Password reset token generated successfully.',
      // For development simplicity we return the token
      resetToken,
    };
  }

  static async resetPassword(input: ResetPasswordInput) {
    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { token: input.token },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.used || tokenRecord.expiresAt < new Date()) {
      throw new BadRequestError('Invalid or expired password reset token');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(input.newPassword, salt);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { used: true },
      }),
    ]);

    await NotificationService.createNotification({
      userId: tokenRecord.userId,
      title: 'Password Changed Successfully',
      message: 'Your account password has been updated.',
      type: NotificationType.SYSTEM,
    });

    return { message: 'Password has been reset successfully. You can now login.' };
  }
}
