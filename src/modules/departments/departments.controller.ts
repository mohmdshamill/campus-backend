import { Request, Response, NextFunction } from 'express';
import { DepartmentService } from './departments.service';
import { sendSuccess } from '../../utils/response';

export class DepartmentController {
  static async listDepartments(req: Request, res: Response, next: NextFunction) {
    try {
      const departments = await DepartmentService.listDepartments(req.query);
      return sendSuccess(res, departments, 'Departments retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const department = await DepartmentService.getDepartmentById(req.params.id);
      return sendSuccess(res, department, 'Department details retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async createDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const department = await DepartmentService.createDepartment(
        req.body,
        req.user?.id,
        req.user?.email
      );
      return sendSuccess(res, department, 'Department created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const department = await DepartmentService.updateDepartment(
        req.params.id,
        req.body,
        req.user?.id,
        req.user?.email
      );
      return sendSuccess(res, department, 'Department updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async assignCoordinator(req: Request, res: Response, next: NextFunction) {
    try {
      const membership = await DepartmentService.assignCoordinator(
        req.params.id,
        req.body,
        req.user?.id,
        req.user?.email
      );
      return sendSuccess(res, membership, 'Coordinator assigned successfully');
    } catch (error) {
      next(error);
    }
  }

  static async removeCoordinator(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await DepartmentService.removeCoordinator(
        req.params.id,
        req.params.userId,
        req.user?.id,
        req.user?.email
      );
      return sendSuccess(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }
}
