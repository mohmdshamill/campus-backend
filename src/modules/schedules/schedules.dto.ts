import { z } from 'zod';
import { DayOfWeek } from '@prisma/client';

export const CreateAcademicScheduleDto = z.object({
  resourceId: z.string().uuid('Valid resource ID is required'),
  departmentId: z.string().uuid('Valid department ID is required'),
  courseName: z.string().min(2, 'Course name is required'),
  courseCode: z.string().min(2, 'Course code is required'),
  instructorName: z.string().min(2, 'Instructor name is required'),
  dayOfWeek: z.nativeEnum(DayOfWeek),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format must be HH:mm'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format must be HH:mm'),
  semester: z.string().min(1, 'Semester is required'),
  academicYear: z.string().min(4, 'Academic year is required (e.g. 2026-2027)'),
  isActive: z.boolean().default(true),
});

export const UpdateAcademicScheduleDto = CreateAcademicScheduleDto.partial();

export type CreateAcademicScheduleInput = z.infer<typeof CreateAcademicScheduleDto>;
export type UpdateAcademicScheduleInput = z.infer<typeof UpdateAcademicScheduleDto>;
