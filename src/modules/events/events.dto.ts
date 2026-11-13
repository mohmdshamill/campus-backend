import { z } from 'zod';

export const CreateCollegeEventDto = z.object({
  resourceId: z.string().uuid('Valid resource ID is required'),
  title: z.string().min(2, 'Event title is required'),
  description: z.string().optional().nullable(),
  organizer: z.string().min(2, 'Organizer name or department is required'),
  eventType: z.string().default('SEMINAR'), // CONFERENCE, WORKSHOP, CULTURAL, etc.
  startDateTime: z.string().datetime('Valid start ISO datetime required'),
  endDateTime: z.string().datetime('Valid end ISO datetime required'),
  isCancelled: z.boolean().default(false),
});

export const UpdateCollegeEventDto = CreateCollegeEventDto.partial();

export type CreateCollegeEventInput = z.infer<typeof CreateCollegeEventDto>;
export type UpdateCollegeEventInput = z.infer<typeof UpdateCollegeEventDto>;
