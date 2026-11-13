import { Request, Response, NextFunction } from 'express';
import { AuditService } from './audit.service';
import { sendSuccess } from '../../utils/response';

export class AuditController {
  static async listLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await AuditService.getLogs(req.query);
      return sendSuccess(res, result.logs, 'Audit logs retrieved', 200, {
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
