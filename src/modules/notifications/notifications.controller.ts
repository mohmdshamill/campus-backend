import { Request, Response, NextFunction } from 'express';
import { NotificationService } from './notifications.service';
import { sendSuccess } from '../../utils/response';

export class NotificationController {
  static async listNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await NotificationService.getUserNotifications(req.user!.id, {
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
        unreadOnly: req.query.unreadOnly === 'true',
      });

      return sendSuccess(res, result.notifications, 'Notifications retrieved', 200, {
        total: result.total,
        unreadCount: result.unreadCount,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  }

  static async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      await NotificationService.markAsRead(req.params.id, req.user!.id);
      return sendSuccess(res, null, 'Notification marked as read');
    } catch (error) {
      next(error);
    }
  }

  static async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      await NotificationService.markAllAsRead(req.user!.id);
      return sendSuccess(res, null, 'All notifications marked as read');
    } catch (error) {
      next(error);
    }
  }
}
