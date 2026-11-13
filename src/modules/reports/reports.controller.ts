import { Request, Response, NextFunction } from 'express';
import { ReportsService } from './reports.service';
import { sendSuccess } from '../../utils/response';

export class ReportsController {
  static async getWebsiteAdminDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await ReportsService.getWebsiteAdminDashboard();
      return sendSuccess(res, data, 'Website Admin dashboard metrics retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getCoordinatorDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await ReportsService.getCoordinatorDashboard(
        req.user!.id,
        req.query.departmentId as string
      );
      return sendSuccess(res, data, 'Coordinator dashboard metrics retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getStudentDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await ReportsService.getStudentDashboard(req.user!.id);
      return sendSuccess(res, data, 'Student dashboard metrics retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await ReportsService.getAnalytics(req.query as any, {
        id: req.user!.id,
        role: req.user!.role,
        departmentId: req.user!.departmentId,
      });
      return sendSuccess(res, data, 'Analytics data retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async exportBookingsCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const csvData = await ReportsService.exportBookingsCsv(req.query as any, {
        id: req.user!.id,
        role: req.user!.role,
        departmentId: req.user!.departmentId,
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="campus_connect_bookings.csv"');
      return res.status(200).send(csvData);
    } catch (error) {
      next(error);
    }
  }
}
