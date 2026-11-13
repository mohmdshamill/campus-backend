import { z } from 'zod';

export const CreateDepartmentDto = z.object({
  name: z.string().min(2, 'Department name is required'),
  code: z.string().min(2, 'Department code is required (e.g. CSE)'),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export const UpdateDepartmentDto = CreateDepartmentDto.partial();

export const AssignCoordinatorDto = z.object({
  userId: z.string().uuid('Valid user ID required'),
  roleInDept: z.string().optional().default('COORDINATOR'),
  isPrimary: z.boolean().optional().default(false),
});

export type CreateDepartmentInput = z.infer<typeof CreateDepartmentDto>;
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentDto>;
export type AssignCoordinatorInput = z.infer<typeof AssignCoordinatorDto>;
