import { z } from 'zod';
import { ResourceType, ResourceMaintenanceStatus } from '@prisma/client';

export const CreateResourceDto = z.object({
  name: z.string().min(2, 'Resource name is required'),
  code: z.string().min(2, 'Unique resource code is required (e.g. AUD-01)'),
  type: z.nativeEnum(ResourceType),
  description: z.string().optional().nullable(),
  departmentId: z.string().uuid('Valid department ID is required'),
  building: z.string().min(1, 'Building is required'),
  roomNumber: z.string().min(1, 'Room number is required'),
  floor: z.string().optional().nullable(),
  capacity: z.number().int().positive('Capacity must be greater than 0'),
  facilities: z.string().optional().nullable(),
  operatingHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format must be HH:mm').default('08:00'),
  operatingHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format must be HH:mm').default('18:00'),
  minBookingMinutes: z.number().int().positive().default(30),
  maxBookingMinutes: z.number().int().positive().default(240),
  minAdvanceDays: z.number().int().nonnegative().default(0),
  maxAdvanceDays: z.number().int().positive().default(14),
  requiresApproval: z.boolean().default(true),
  isActive: z.boolean().default(true),
  maintenanceStatus: z.nativeEnum(ResourceMaintenanceStatus).default(ResourceMaintenanceStatus.OPERATIONAL),
});

export const UpdateResourceDto = CreateResourceDto.partial();

export type CreateResourceInput = z.infer<typeof CreateResourceDto>;
export type UpdateResourceInput = z.infer<typeof UpdateResourceDto>;
