import { Router } from 'express';
import { EventController } from './events.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireCoordinatorOrAdmin, denyWebsiteAdmin } from '../../middleware/role.middleware';
import { validateRequest } from '../../middleware/validate.middleware';
import { CreateCollegeEventDto, UpdateCollegeEventDto } from './events.dto';

const router = Router();

router.use(authenticate);
router.use(denyWebsiteAdmin);

router.get('/', EventController.listEvents);
router.get('/:id', EventController.getEvent);

router.post(
  '/',
  requireCoordinatorOrAdmin,
  validateRequest(CreateCollegeEventDto),
  EventController.createEvent
);
router.patch(
  '/:id',
  requireCoordinatorOrAdmin,
  validateRequest(UpdateCollegeEventDto),
  EventController.updateEvent
);
router.delete(
  '/:id',
  requireCoordinatorOrAdmin,
  EventController.cancelEvent
);

export default router;
