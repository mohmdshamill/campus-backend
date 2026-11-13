import { Request, Response, NextFunction } from 'express';
import { UserService, CreateUserDto } from './users.service';
import { sendSuccess } from '../../utils/response';

export class UserController {
  static async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await UserService.listUsers(req.query);
      return sendSuccess(res, result.users, 'Users retrieved', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  }

  static async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = CreateUserDto.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: parsed.error.errors[0]?.message || 'Validation failed',
        });
      }
      const created = await UserService.createUser(parsed.data, req.user?.id, req.user?.email, req.user?.role);
      return sendSuccess(res, created, 'User created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async getUser(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await UserService.getUserById(req.params.id);
      return sendSuccess(res, user, 'User details retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const updated = await UserService.updateUser(
        req.params.id,
        req.body,
        req.user?.id,
        req.user?.email,
        req.user?.role
      );
      return sendSuccess(res, updated, 'User updated successfully');
    } catch (error) {
      next(error);
    }
  }
}
