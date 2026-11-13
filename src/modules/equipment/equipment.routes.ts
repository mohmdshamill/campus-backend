import { Router } from 'express';
import { EquipmentController } from './equipment.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireCoordinatorOrAdmin, denyWebsiteAdmin } from '../../middleware/role.middleware';
import { validateRequest } from '../../middleware/validate.middleware';
import {
  CreateEquipmentDto,
  UpdateEquipmentDto,
  RequestBorrowEquipmentDto,
  IssueEquipmentDto,
  ReturnEquipmentDto,
} from './equipment.dto';

const router = Router();

router.use(authenticate);
router.use(denyWebsiteAdmin);

// Publicly browseable to authenticated users
router.get('/', EquipmentController.listEquipment);
router.get('/transactions', EquipmentController.listTransactions);
router.get('/:id', EquipmentController.getEquipment);
router.post('/borrow', validateRequest(RequestBorrowEquipmentDto), EquipmentController.requestBorrow);

// Coordinator/Website Admin management
router.post(
  '/',
  requireCoordinatorOrAdmin,
  validateRequest(CreateEquipmentDto),
  EquipmentController.createEquipment
);
router.patch(
  '/:id',
  requireCoordinatorOrAdmin,
  validateRequest(UpdateEquipmentDto),
  EquipmentController.updateEquipment
);
router.patch(
  '/transactions/:id/issue',
  requireCoordinatorOrAdmin,
  validateRequest(IssueEquipmentDto),
  EquipmentController.issueEquipment
);
router.patch(
  '/transactions/:id/return',
  requireCoordinatorOrAdmin,
  validateRequest(ReturnEquipmentDto),
  EquipmentController.returnEquipment
);

export default router;
