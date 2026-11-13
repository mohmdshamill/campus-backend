import { Router } from 'express';
import { ScheduleController } from './schedules.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireCoordinatorOrAdmin, denyWebsiteAdmin } from '../../middleware/role.middleware';
import { validateRequest } from '../../middleware/validate.middleware';
import { CreateAcademicScheduleDto, UpdateAcademicScheduleDto } from './schedules.dto';

const router = Router();

router.use(authenticate);
router.use(denyWebsiteAdmin);

router.get('/', ScheduleController.listSchedules);
router.get('/:id', ScheduleController.getSchedule);

router.post(
  '/',
  requireCoordinatorOrAdmin,
  validateRequest(CreateAcademicScheduleDto),
  ScheduleController.createSchedule
);
router.patch(
  '/:id',
  requireCoordinatorOrAdmin,
  validateRequest(UpdateAcademicScheduleDto),
  ScheduleController.updateSchedule
);
router.delete(
  '/:id',
  requireCoordinatorOrAdmin,
  ScheduleController.deleteSchedule
);

export default router;
