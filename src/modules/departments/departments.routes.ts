import { Router } from 'express';
import { DepartmentController } from './departments.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { validateRequest } from '../../middleware/validate.middleware';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  AssignCoordinatorDto,
} from './departments.dto';

const router = Router();

router.use(authenticate);

// List and view departments accessible to all logged-in users
router.get('/', DepartmentController.listDepartments);
router.get('/:id', DepartmentController.getDepartment);

// Manage departments restricted to Website Admin
router.post(
  '/',
  requireAdmin,
  validateRequest(CreateDepartmentDto),
  DepartmentController.createDepartment
);
router.patch(
  '/:id',
  requireAdmin,
  validateRequest(UpdateDepartmentDto),
  DepartmentController.updateDepartment
);
router.post(
  '/:id/coordinators',
  requireAdmin,
  validateRequest(AssignCoordinatorDto),
  DepartmentController.assignCoordinator
);
router.delete(
  '/:id/coordinators/:userId',
  requireAdmin,
  DepartmentController.removeCoordinator
);

export default router;
