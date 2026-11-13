import { z } from 'zod';
import { MaintenanceStatus, Priority } from '@prisma/client';

export const CreateMaintenanceDto = z.object({
  resourceId: z.string().uuid('Valid resource ID is required'),
  title: z.string().min(3, 'Title is required'),
  description: z.string().min(5, 'Detailed description is required'),
  // Optional: a report starts now and stays open until it is resolved
  startDateTime: z.string().datetime('Valid start ISO datetime required').optional(),
  endDateTime: z.string().datetime('Valid end ISO datetime required').optional(),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
  blockResource: z.boolean().default(true),
});

export const UpdateMaintenanceDto = z.object({
  status: z.nativeEnum(MaintenanceStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  resolutionNotes: z.string().optional().nullable(),
  endDateTime: z.string().datetime().optional(),
});

export type CreateMaintenanceInput = z.infer<typeof CreateMaintenanceDto>;
export type UpdateMaintenanceInput = z.infer<typeof UpdateMaintenanceDto>;
