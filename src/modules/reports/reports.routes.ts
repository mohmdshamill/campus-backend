import { Router } from 'express';
import { ReportsController } from './reports.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireCoordinatorOrAdmin, requireAdmin } from '../../middleware/role.middleware';

const router = Router();

router.use(authenticate);

// Role-specific dashboard endpoints
router.get('/dashboard/admin', requireAdmin, ReportsController.getWebsiteAdminDashboard);
router.get('/dashboard/coordinator', requireCoordinatorOrAdmin, ReportsController.getCoordinatorDashboard);
router.get('/dashboard/student', ReportsController.getStudentDashboard);

// Analytics and reporting
router.get('/analytics', requireCoordinatorOrAdmin, ReportsController.getAnalytics);
router.get('/export/bookings', requireCoordinatorOrAdmin, ReportsController.exportBookingsCsv);

export default router;
