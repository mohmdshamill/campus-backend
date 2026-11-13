import { Router } from 'express';
import { exportMyBookingsIcs } from './bookings.ics';
import { BookingController } from './bookings.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireSuperAdmin } from '../../middleware/role.middleware';
import { validateRequest } from '../../middleware/validate.middleware';
import {
  CreateBookingDto,
  ApproveBookingDto,
  RejectBookingDto,
  CancelBookingDto,
} from './bookings.dto';

const router = Router();

router.use(authenticate);

// Student/all user routes
router.post('/', validateRequest(CreateBookingDto), BookingController.createBooking);
router.get('/', BookingController.listBookings);
router.get('/my-bookings', BookingController.getMyBookings);
router.get('/my-bookings.ics', exportMyBookingsIcs);
router.get('/:id', BookingController.getBooking);
router.patch('/:id/cancel', validateRequest(CancelBookingDto), BookingController.cancelBooking);

// Only the Super Admin can approve or reject bookings
router.patch(
  '/:id/approve',
  requireSuperAdmin,
  validateRequest(ApproveBookingDto),
  BookingController.approveBooking
);
router.patch(
  '/:id/reject',
  requireSuperAdmin,
  validateRequest(RejectBookingDto),
  BookingController.rejectBooking
);

export default router;
