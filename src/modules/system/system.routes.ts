import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/role.middleware';
import { sendSuccess } from '../../utils/response';
import { prisma } from '../../config/db';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

// Live platform health for the admin console: DB latency, uptime, row counts.
router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - t0;

    const [users, resources, bookings, pendingBookings, openMaintenance] = await Promise.all([
      prisma.user.count(),
      prisma.resource.count(),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: 'PENDING' } }),
      prisma.maintenanceRecord.count({ where: { status: { in: ['REPORTED', 'IN_PROGRESS'] } } }),
    ]);

    return sendSuccess(res, {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      nodeVersion: process.version,
      dbLatencyMs,
      counts: { users, resources, bookings, pendingBookings, openMaintenance },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
