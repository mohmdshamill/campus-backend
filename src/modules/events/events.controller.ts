import { Request, Response, NextFunction } from 'express';
import { EventService } from './events.service';
import { sendSuccess } from '../../utils/response';

export class EventController {
  static async listEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const events = await EventService.listEvents(req.query as any);
      return sendSuccess(res, events, 'College events retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await EventService.getEventById(req.params.id);
      return sendSuccess(res, event, 'Event retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async createEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await EventService.createEvent(
        req.body,
        req.user!.id,
        req.user!.email
      );
      return sendSuccess(res, event, 'Event created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await EventService.updateEvent(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.email
      );
      return sendSuccess(res, event, 'Event updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async cancelEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await EventService.cancelEvent(
        req.params.id,
        req.user!.id,
        req.user!.email
      );
      return sendSuccess(res, result, 'Event cancelled successfully');
    } catch (error) {
      next(error);
    }
  }
}
