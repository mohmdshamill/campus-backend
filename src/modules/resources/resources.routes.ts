import { Router } from 'express';
import { ResourceController } from './resources.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireCoordinatorOrAdmin, denyWebsiteAdmin } from '../../middleware/role.middleware';
import { validateRequest } from '../../middleware/validate.middleware';
import { CreateResourceDto, UpdateResourceDto } from './resources.dto';

const router = Router();

router.use(authenticate);
router.use(denyWebsiteAdmin);

// Publicly browseable to authenticated users (students, coordinators, website admin)
router.get('/', ResourceController.listResources);
router.get('/:id', ResourceController.getResource);
router.get('/:id/availability', ResourceController.getAvailability);

// Coordinator & Website Admin resource operations
router.post(
  '/',
  requireCoordinatorOrAdmin,
  validateRequest(CreateResourceDto),
  ResourceController.createResource
);
router.patch(
  '/:id',
  requireCoordinatorOrAdmin,
  validateRequest(UpdateResourceDto),
  ResourceController.updateResource
);
router.delete(
  '/:id',
  requireCoordinatorOrAdmin,
  ResourceController.deleteResource
);

export default router;
