import { Router } from 'express';
import { MaintenanceController } from './maintenance.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireCoordinatorOrAdmin, denyWebsiteAdmin, requireSuperAdmin } from '../../middleware/role.middleware';
import { validateRequest } from '../../middleware/validate.middleware';
import { CreateMaintenanceDto, UpdateMaintenanceDto } from './maintenance.dto';

const router = Router();

router.use(authenticate);
router.use(denyWebsiteAdmin);

router.get('/', MaintenanceController.listMaintenance);
router.get('/:id', MaintenanceController.getMaintenance);

router.post(
  '/',
  requireCoordinatorOrAdmin,
  validateRequest(CreateMaintenanceDto),
  MaintenanceController.createMaintenance
);
// Only the Super Admin can update / resolve a maintenance issue
router.patch(
  '/:id',
  requireSuperAdmin,
  validateRequest(UpdateMaintenanceDto),
  MaintenanceController.updateMaintenance
);

export default router;
