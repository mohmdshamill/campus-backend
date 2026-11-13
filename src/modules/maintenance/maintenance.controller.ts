import { Request, Response, NextFunction } from 'express';
import { MaintenanceService } from './maintenance.service';
import { sendSuccess } from '../../utils/response';

export class MaintenanceController {
  static async listMaintenance(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await MaintenanceService.listMaintenance({ id: req.user!.id, role: req.user!.role }, req.query as any);
      return sendSuccess(res, result.records, 'Maintenance records retrieved', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getMaintenance(req: Request, res: Response, next: NextFunction) {
    try {
      const record = await MaintenanceService.getMaintenanceById(req.params.id);
      return sendSuccess(res, record, 'Maintenance details retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async createMaintenance(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await MaintenanceService.createMaintenance(
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, result, 'Maintenance record created', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateMaintenance(req: Request, res: Response, next: NextFunction) {
    try {
      const updated = await MaintenanceService.updateMaintenance(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, updated, 'Maintenance record updated successfully');
    } catch (error) {
      next(error);
    }
  }
}
