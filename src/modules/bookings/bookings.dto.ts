import { z } from 'zod';
import { BookingStatus } from '@prisma/client';

export const CreateBookingDto = z.object({
  resourceId: z.string().uuid('Valid resource ID is required'),
  startDateTime: z.string().datetime('Valid start ISO datetime required'),
  endDateTime: z.string().datetime('Valid end ISO datetime required'),
  purpose: z.string().min(3, 'Booking purpose must be at least 3 characters'),
  attendeesCount: z.number().int().positive().default(1),
  specialRequirements: z.string().optional().nullable(),
});

export const ApproveBookingDto = z.object({
  notes: z.string().optional(),
});

export const RejectBookingDto = z.object({
  reason: z.string().min(3, 'Rejection reason is required'),
});

export const CancelBookingDto = z.object({
  reason: z.string().min(3, 'Cancellation reason is required'),
});

export type CreateBookingInput = z.infer<typeof CreateBookingDto>;
export type ApproveBookingInput = z.infer<typeof ApproveBookingDto>;
export type RejectBookingInput = z.infer<typeof RejectBookingDto>;
export type CancelBookingInput = z.infer<typeof CancelBookingDto>;
