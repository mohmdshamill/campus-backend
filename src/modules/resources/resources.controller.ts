import { Request, Response, NextFunction } from 'express';
import { ResourceService } from './resources.service';
import { sendSuccess } from '../../utils/response';

export class ResourceController {
  static async listResources(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ResourceService.listResources(req.query);
      return sendSuccess(res, result.resources, 'Resources retrieved', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getResource(req: Request, res: Response, next: NextFunction) {
    try {
      const resource = await ResourceService.getResourceById(req.params.id);
      return sendSuccess(res, resource, 'Resource details retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const availability = await ResourceService.getResourceAvailability(req.params.id, date);
      return sendSuccess(res, availability, 'Resource availability schedule retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async createResource(req: Request, res: Response, next: NextFunction) {
    try {
      const resource = await ResourceService.createResource(
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, resource, 'Resource created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateResource(req: Request, res: Response, next: NextFunction) {
    try {
      const resource = await ResourceService.updateResource(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, resource, 'Resource updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteResource(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ResourceService.deleteOrDeactivate(
        req.params.id,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }
}
