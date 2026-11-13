import { Router } from 'express';
import { UserController } from './users.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';

const router = Router();

router.use(authenticate);

// List and view users
router.get('/', requireAdmin, UserController.listUsers);
router.post('/', requireAdmin, UserController.createUser);
router.get('/:id', requireAdmin, UserController.getUser);
router.patch('/:id', requireAdmin, UserController.updateUser);

export default router;
