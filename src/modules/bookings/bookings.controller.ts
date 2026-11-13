import { Request, Response, NextFunction } from 'express';
import { BookingService } from './bookings.service';
import { sendSuccess } from '../../utils/response';
import { Role } from '@prisma/client';


export class BookingController {
  static async createBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await BookingService.createBooking(
        req.body,
        req.user!.id,
        req.user!.email,
        req.ip
      );
      return sendSuccess(res, booking, 'Booking request created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  static async listBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await BookingService.listBookings(req.query, {
        id: req.user!.id,
        role: req.user!.role,
        departmentId: req.user!.departmentId,
      });

      return sendSuccess(res, result.bookings, 'Bookings retrieved', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getMyBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const query = { ...req.query, userId: req.user!.id };
      const result = await BookingService.listBookings(query, {
        id: req.user!.id,
        role: Role.STUDENT,
        departmentId: req.user!.departmentId,
      });

      return sendSuccess(res, result.bookings, 'My bookings retrieved', 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await BookingService.getBookingById(
        req.params.id,
        req.user!.id,
        req.user!.role
      );
      return sendSuccess(res, booking, 'Booking details retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async approveBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await BookingService.approveBooking(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, booking, 'Booking approved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async rejectBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await BookingService.rejectBooking(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, booking, 'Booking rejected');
    } catch (error) {
      next(error);
    }
  }

  static async cancelBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await BookingService.cancelBooking(
        req.params.id,
        req.body,
        req.user!.id,
        req.user!.role,
        req.user!.email
      );
      return sendSuccess(res, booking, 'Booking cancelled successfully');
    } catch (error) {
      next(error);
    }
  }
}
