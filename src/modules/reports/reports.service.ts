import { prisma } from '../../config/db';
import { BookingStatus, EquipmentTransactionStatus, ResourceMaintenanceStatus, Role } from '@prisma/client';
import { checkDepartmentAccess } from '../../middleware/role.middleware';
import { ForbiddenError } from '../../utils/errors';

export class ReportsService {
  /**
   * Website Admin College-wide Dashboard Metrics
   */
  static async getWebsiteAdminDashboard() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      totalDepartments,
      totalUsers,
      totalResources,
      todayBookingsCount,
      pendingBookingsCount,
      underMaintenanceCount,
      recentBookings,
      upcomingEvents,
      departments,
    ] = await Promise.all([
      prisma.department.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.resource.count({ where: { isActive: true } }),
      prisma.booking.count({
        where: {
          startDateTime: { gte: todayStart, lte: todayEnd },
          status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
        },
      }),
      prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
      prisma.resource.count({
        where: { maintenanceStatus: ResourceMaintenanceStatus.UNDER_MAINTENANCE },
      }),
      prisma.booking.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true, email: true, collegeId: true } },
          resource: {
            select: { name: true, code: true, department: { select: { name: true, code: true } } },
          },
        },
      }),
      prisma.collegeEvent.findMany({
        where: { isCancelled: false, endDateTime: { gte: new Date() } },
        take: 5,
        orderBy: { startDateTime: 'asc' },
        include: { resource: { select: { name: true, building: true } } },
      }),
      prisma.department.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          _count: {
            select: {
              resources: true,
              equipment: true,
              users: true,
            },
          },
        },
      }),
    ]);

    // Department-wise booking count
    const departmentUtilization = await Promise.all(
      departments.map(async (d) => {
        const bookingsCount = await prisma.booking.count({
          where: { resource: { departmentId: d.id } },
        });
        return {
          id: d.id,
          name: d.name,
          code: d.code,
          resourcesCount: d._count.resources,
          equipmentCount: d._count.equipment,
          usersCount: d._count.users,
          bookingsCount,
        };
      })
    );

    // Status breakdown
    const statusCounts = await prisma.booking.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    return {
      overview: {
        totalDepartments,
        totalUsers,
        totalResources,
        todayBookingsCount,
        pendingBookingsCount,
        underMaintenanceCount,
      },
      recentBookings,
      upcomingEvents,
      departmentUtilization,
      statusBreakdown: statusCounts.map((s) => ({
        status: s.status,
        count: s._count.id,
      })),
    };
  }

  /**
   * Coordinator Dashboard Metrics
   */
  static async getCoordinatorDashboard(actorId: string, departmentIdParam?: string) {
    const user = await prisma.user.findUnique({
      where: { id: actorId },
      include: { memberships: true },
    });

    const userDeptIds = [
      user?.departmentId,
      ...(user?.memberships.map((m) => m.departmentId) || []),
    ].filter(Boolean) as string[];

    const activeDeptId = departmentIdParam && userDeptIds.includes(departmentIdParam)
      ? departmentIdParam
      : userDeptIds[0];

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const whereDept = activeDeptId ? { departmentId: activeDeptId } : {};
    const whereBookingDept = activeDeptId ? { resource: { departmentId: activeDeptId } } : {};

    const [
      departmentInfo,
      resourceCount,
      todayBookingsCount,
      pendingApprovalsCount,
      operationalResources,
      maintenanceResources,
      upcomingReservations,
      recentActivity,
      equipmentAlertsCount,
    ] = await Promise.all([
      activeDeptId ? prisma.department.findUnique({ where: { id: activeDeptId } }) : null,
      prisma.resource.count({ where: { ...whereDept, isActive: true } }),
      prisma.booking.count({
        where: {
          ...whereBookingDept,
          startDateTime: { gte: todayStart, lte: todayEnd },
          status: { in: [BookingStatus.APPROVED, BookingStatus.PENDING] },
        },
      }),
      prisma.booking.count({
        where: { ...whereBookingDept, status: BookingStatus.PENDING },
      }),
      prisma.resource.count({
        where: { ...whereDept, isActive: true, maintenanceStatus: ResourceMaintenanceStatus.OPERATIONAL },
      }),
      prisma.resource.count({
        where: { ...whereDept, maintenanceStatus: ResourceMaintenanceStatus.UNDER_MAINTENANCE },
      }),
      prisma.booking.findMany({
        where: {
          ...whereBookingDept,
          startDateTime: { gte: new Date() },
          status: BookingStatus.APPROVED,
        },
        take: 6,
        orderBy: { startDateTime: 'asc' },
        include: {
          resource: { select: { name: true, roomNumber: true } },
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.booking.findMany({
        where: whereBookingDept,
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: {
          resource: { select: { name: true, code: true } },
          user: { select: { name: true, collegeId: true } },
        },
      }),
      prisma.equipmentTransaction.count({
        where: {
          ...(activeDeptId ? { equipment: { departmentId: activeDeptId } } : {}),
          status: EquipmentTransactionStatus.ISSUED,
          expectedReturnDate: { lt: new Date() },
        },
      }),
    ]);

    return {
      department: departmentInfo,
      overview: {
        resourceCount,
        todayBookingsCount,
        pendingApprovalsCount,
        operationalResources,
        maintenanceResources,
        equipmentAlertsCount,
      },
      upcomingReservations,
      recentActivity,
    };
  }

  /**
   * Student Dashboard Metrics
   */
  static async getStudentDashboard(userId: string) {
    const today = new Date();

    const [
      user,
      upcomingBookings,
      pendingBookings,
      recentHistory,
      activeEquipment,
      unreadNotificationsCount,
      featuredResources,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, collegeId: true, email: true, department: { select: { name: true } } },
      }),
      prisma.booking.findMany({
        where: {
          userId,
          status: BookingStatus.APPROVED,
          startDateTime: { gte: today },
        },
        take: 4,
        orderBy: { startDateTime: 'asc' },
        include: {
          resource: {
            select: { name: true, code: true, building: true, roomNumber: true },
          },
        },
      }),
      prisma.booking.findMany({
        where: {
          userId,
          status: BookingStatus.PENDING,
        },
        take: 4,
        orderBy: { createdAt: 'desc' },
        include: {
          resource: {
            select: { name: true, code: true },
          },
        },
      }),
      prisma.booking.findMany({
        where: { userId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          resource: { select: { name: true, code: true } },
        },
      }),
      prisma.equipmentTransaction.findMany({
        where: {
          userId,
          status: { in: [EquipmentTransactionStatus.REQUESTED, EquipmentTransactionStatus.ISSUED] },
        },
        take: 4,
        include: {
          equipment: { select: { name: true, assetCode: true, location: true } },
        },
      }),
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
      prisma.resource.findMany({
        where: { isActive: true, maintenanceStatus: ResourceMaintenanceStatus.OPERATIONAL },
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { department: { select: { name: true, code: true } } },
      }),
    ]);

    return {
      user,
      upcomingBookings,
      pendingBookings,
      recentHistory,
      activeEquipment,
      unreadNotificationsCount,
      featuredResources,
    };
  }

  /**
   * Comprehensive Analytics & Utilization Data
   */
  static async getAnalytics(query: {
    startDate?: string;
    endDate?: string;
    departmentId?: string;
  }, actorUser: { id: string; role: Role; departmentId?: string | null }) {
    if (actorUser.role === Role.STUDENT) {
      throw new ForbiddenError('Students cannot access organizational analytics');
    }

    const where: any = {};
    if (actorUser.role === Role.COORDINATOR) {
      const hasAccess = await checkDepartmentAccess(actorUser.id, actorUser.role, query.departmentId || actorUser.departmentId || '');
      if (query.departmentId && !hasAccess) {
        throw new ForbiddenError('Access restricted to assigned departments');
      }
      where.resource = { departmentId: query.departmentId || actorUser.departmentId };
    } else if (query.departmentId) {
      where.resource = { departmentId: query.departmentId };
    }

    if (query.startDate || query.endDate) {
      where.startDateTime = {};
      if (query.startDate) where.startDateTime.gte = new Date(query.startDate);
      if (query.endDate) where.startDateTime.lte = new Date(query.endDate);
    }

    // Status breakdown
    const statusCounts = await prisma.booking.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    });

    // Most frequently booked resources
    const topResources = await prisma.booking.groupBy({
      by: ['resourceId'],
      where: { ...where, status: BookingStatus.APPROVED },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 6,
    });

    const topResourcesEnriched = await Promise.all(
      topResources.map(async (r) => {
        const resObj = await prisma.resource.findUnique({
          where: { id: r.resourceId },
          select: { name: true, code: true, type: true },
        });
        return {
          name: resObj?.name || 'Unknown',
          code: resObj?.code || '',
          type: resObj?.type,
          count: r._count.id,
        };
      })
    );

    // Total counts
    const totalBookings = await prisma.booking.count({ where });
    const approvedBookings = await prisma.booking.count({
      where: { ...where, status: BookingStatus.APPROVED },
    });
    const rejectedBookings = await prisma.booking.count({
      where: { ...where, status: BookingStatus.REJECTED },
    });
    const cancelledBookings = await prisma.booking.count({
      where: { ...where, status: BookingStatus.CANCELLED },
    });

    // Overdue equipment items
    const overdueEquipmentCount = await prisma.equipmentTransaction.count({
      where: {
        status: EquipmentTransactionStatus.ISSUED,
        expectedReturnDate: { lt: new Date() },
      },
    });

    return {
      summary: {
        totalBookings,
        approvedBookings,
        rejectedBookings,
        cancelledBookings,
        approvalRate: totalBookings > 0 ? Math.round((approvedBookings / totalBookings) * 100) : 0,
        overdueEquipmentCount,
      },
      statusDistribution: statusCounts.map((s) => ({
        name: s.status,
        value: s._count.id,
      })),
      topResources: topResourcesEnriched,
    };
  }

  /**
   * Export bookings report to CSV format
   */
  static async exportBookingsCsv(query: {
    startDate?: string;
    endDate?: string;
    departmentId?: string;
  }, actorUser: { id: string; role: Role; departmentId?: string | null }) {
    if (actorUser.role === Role.STUDENT) {
      throw new ForbiddenError('Students cannot export reports');
    }

    const where: any = {};
    if (actorUser.role === Role.COORDINATOR) {
      where.resource = { departmentId: actorUser.departmentId };
    } else if (query.departmentId) {
      where.resource = { departmentId: query.departmentId };
    }

    if (query.startDate || query.endDate) {
      where.startDateTime = {};
      if (query.startDate) where.startDateTime.gte = new Date(query.startDate);
      if (query.endDate) where.startDateTime.lte = new Date(query.endDate);
    }

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: { startDateTime: 'desc' },
      include: {
        resource: { include: { department: true } },
        user: true,
      },
      take: 500,
    });

    const headers = [
      'Booking Code',
      'Resource',
      'Department',
      'Booked By',
      'Roll / College ID',
      'Start Time',
      'End Time',
      'Purpose',
      'Status',
      'Created At',
    ];

    const rows = bookings.map((b) => [
      b.bookingCode,
      `"${b.resource.name} (${b.resource.code})"`,
      `"${b.resource.department.name}"`,
      `"${b.user.name}"`,
      b.user.collegeId || '',
      b.startDateTime.toISOString(),
      b.endDateTime.toISOString(),
      `"${b.purpose.replace(/"/g, '""')}"`,
      b.status,
      b.createdAt.toISOString(),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    return csvContent;
  }
}
