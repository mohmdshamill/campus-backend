import { Request, Response, NextFunction } from 'express';
import { ScheduleService } from './schedules.service';
import { sendSuccess } from '../../utils/response';

export class ScheduleController {
  static async listSchedules(req: Request, res: Response, next: NextFunction) {
    try {
      const schedules = await ScheduleService.listSchedules(req.query as any);
      return sendSuccess(res, schedules, 'Academic schedules retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await ScheduleService.getScheduleById(req.params.id);
      return sendSuccess(res, schedule, 'Schedule retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async createSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ScheduleService.createSchedule(
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, result, 'Schedule created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const updated = await ScheduleService.updateSchedule(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, updated, 'Schedule updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ScheduleService.deleteSchedule(
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
