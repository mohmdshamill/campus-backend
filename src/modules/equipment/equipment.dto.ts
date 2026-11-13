import { z } from 'zod';
import { EquipmentCondition, EquipmentTransactionStatus } from '@prisma/client';

export const CreateEquipmentDto = z.object({
  name: z.string().min(2, 'Equipment name is required'),
  assetCode: z.string().min(2, 'Unique asset code is required (e.g. LAB-EQ-001)'),
  category: z.string().min(2, 'Category is required'),
  departmentId: z.string().uuid('Valid department ID is required'),
  quantityOwned: z.number().int().positive('Quantity owned must be at least 1'),
  quantityAvailable: z.number().int().nonnegative().optional(),
  condition: z.nativeEnum(EquipmentCondition).default(EquipmentCondition.EXCELLENT),
  location: z.string().min(1, 'Location is required'),
  description: z.string().optional().nullable(),
  maintenanceStatus: z.string().default('OPERATIONAL'),
  purchaseDate: z.string().datetime().optional().nullable(),
});

export const UpdateEquipmentDto = CreateEquipmentDto.partial();

export const RequestBorrowEquipmentDto = z.object({
  equipmentId: z.string().uuid('Valid equipment ID is required'),
  quantity: z.number().int().positive().default(1),
  expectedReturnDate: z.string().datetime('Valid expected return date required'),
  purpose: z.string().min(3, 'Borrowing purpose is required'),
  notes: z.string().optional().nullable(),
});

export const IssueEquipmentDto = z.object({
  notes: z.string().optional().nullable(),
});

export const ReturnEquipmentDto = z.object({
  conditionOnReturn: z.nativeEnum(EquipmentCondition).default(EquipmentCondition.GOOD),
  notes: z.string().optional().nullable(),
  status: z.enum(['RETURNED', 'DAMAGED_RETURN', 'LOST']).default('RETURNED'),
});

export type CreateEquipmentInput = z.infer<typeof CreateEquipmentDto>;
export type UpdateEquipmentInput = z.infer<typeof UpdateEquipmentDto>;
export type RequestBorrowEquipmentInput = z.infer<typeof RequestBorrowEquipmentDto>;
export type IssueEquipmentInput = z.infer<typeof IssueEquipmentDto>;
export type ReturnEquipmentInput = z.infer<typeof ReturnEquipmentDto>;
