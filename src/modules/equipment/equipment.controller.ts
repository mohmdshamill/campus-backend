import { Request, Response, NextFunction } from 'express';
import { EquipmentService } from './equipment.service';
import { sendSuccess } from '../../utils/response';

export class EquipmentController {
  static async listEquipment(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EquipmentService.listEquipment(req.query as any);
      return sendSuccess(res, result.items, 'Equipment retrieved', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getEquipment(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await EquipmentService.getEquipmentById(req.params.id);
      return sendSuccess(res, item, 'Equipment details retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async createEquipment(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await EquipmentService.createEquipment(
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, item, 'Equipment item created', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateEquipment(req: Request, res: Response, next: NextFunction) {
    try {
      const updated = await EquipmentService.updateEquipment(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, updated, 'Equipment updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async requestBorrow(req: Request, res: Response, next: NextFunction) {
    try {
      const transaction = await EquipmentService.requestBorrow(
        req.body,
        req.user!.id,
        req.user!.email
      );
      return sendSuccess(res, transaction, 'Borrowing request submitted', 201);
    } catch (error) {
      next(error);
    }
  }

  static async issueEquipment(req: Request, res: Response, next: NextFunction) {
    try {
      const transaction = await EquipmentService.issueEquipment(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, transaction, 'Equipment issued successfully');
    } catch (error) {
      next(error);
    }
  }

  static async returnEquipment(req: Request, res: Response, next: NextFunction) {
    try {
      const transaction = await EquipmentService.returnEquipment(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, transaction, 'Equipment return processed successfully');
    } catch (error) {
      next(error);
    }
  }

  static async listTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EquipmentService.listTransactions(req.query as any, {
        id: req.user!.id,
        role: req.user!.role,
      });
      return sendSuccess(res, result.transactions, 'Transactions retrieved', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  }
}
