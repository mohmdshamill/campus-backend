import { prisma } from '../../config/db';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../utils/errors';
import {
  CreateEquipmentInput,
  UpdateEquipmentInput,
  RequestBorrowEquipmentInput,
  IssueEquipmentInput,
  ReturnEquipmentInput,
} from './equipment.dto';
import { AuditService } from '../audit-logs/audit.service';
import { NotificationService } from '../notifications/notifications.service';
import {
  EquipmentCondition,
  EquipmentTransactionStatus,
  NotificationType,
  Role,
} from '@prisma/client';
import { checkDepartmentAccess } from '../../middleware/role.middleware';

export class EquipmentService {
  static async listEquipment(query: {
    departmentId?: string;
    category?: string;
    search?: string;
    condition?: EquipmentCondition;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 500, 1000);
    const skip = (page - 1) * limit;

    const where: any = { isActive: true };
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.category) where.category = query.category;
    if (query.condition) where.condition = query.condition;

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { assetCode: { contains: query.search, mode: 'insensitive' } },
        { location: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.equipment.count({ where }),
      prisma.equipment.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
        include: {
          department: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { transactions: true },
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getEquipmentById(id: string) {
    const item = await prisma.equipment.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true, code: true } },
        transactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, name: true, email: true } },
            issuedBy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundError('Equipment not found');
    }

    return item;
  }

  static async createEquipment(
    input: CreateEquipmentInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const hasAccess = await checkDepartmentAccess(actorId, actorRole, input.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You are not authorized to add equipment to this department');
    }

    const existingCode = await prisma.equipment.findUnique({
      where: { assetCode: input.assetCode.toUpperCase() },
    });
    if (existingCode) {
      throw new ConflictError(`Asset code ${input.assetCode} is already registered`);
    }

    const equipment = await prisma.equipment.create({
      data: {
        ...input,
        assetCode: input.assetCode.toUpperCase(),
        quantityAvailable: input.quantityAvailable ?? input.quantityOwned,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
      },
      include: { department: true },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'CREATE_EQUIPMENT',
      entityType: 'Equipment',
      entityId: equipment.id,
      details: { name: equipment.name, assetCode: equipment.assetCode },
    });

    return equipment;
  }

  static async updateEquipment(
    id: string,
    input: UpdateEquipmentInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const item = await this.getEquipmentById(id);

    const hasAccess = await checkDepartmentAccess(actorId, actorRole, item.departmentId);
    if (!hasAccess) {
      throw new ForbiddenError('You are not authorized to manage equipment for this department');
    }

    const updated = await prisma.equipment.update({
      where: { id },
      data: {
        ...input,
        assetCode: input.assetCode ? input.assetCode.toUpperCase() : undefined,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : undefined,
      },
      include: { department: true },
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'UPDATE_EQUIPMENT',
      entityType: 'Equipment',
      entityId: id,
      details: input,
    });

    return updated;
  }

  // Equipment borrowing request
  static async requestBorrow(
    input: RequestBorrowEquipmentInput,
    userId: string,
    userEmail: string
  ) {
    const item = await this.getEquipmentById(input.equipmentId);

    if (item.quantityAvailable < input.quantity) {
      throw new BadRequestError(
        `Requested quantity (${input.quantity}) exceeds currently available stock (${item.quantityAvailable})`
      );
    }

    const returnDate = new Date(input.expectedReturnDate);
    if (returnDate <= new Date()) {
      throw new BadRequestError('Expected return date must be in the future');
    }

    const transaction = await prisma.equipmentTransaction.create({
      data: {
        equipmentId: item.id,
        userId,
        quantity: input.quantity,
        status: EquipmentTransactionStatus.REQUESTED,
        expectedReturnDate: returnDate,
        purpose: input.purpose,
        notes: input.notes,
      },
      include: {
        equipment: { include: { department: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    // Notify department coordinators
    const coordinators = await prisma.user.findMany({
      where: {
        OR: [
          { departmentId: item.departmentId, role: Role.COORDINATOR },
          { memberships: { some: { departmentId: item.departmentId } }, role: Role.COORDINATOR },
        ],
      },
      select: { id: true },
    });

    for (const coord of coordinators) {
      await NotificationService.createNotification({
        userId: coord.id,
        title: 'New Equipment Borrow Request',
        message: `${transaction.user.name} requested to borrow ${input.quantity}x ${item.name}.`,
        type: NotificationType.SYSTEM,
      });
    }

    await AuditService.recordLog({
      userId,
      userEmail,
      action: 'REQUEST_EQUIPMENT_BORROW',
      entityType: 'EquipmentTransaction',
      entityId: transaction.id,
      details: { equipmentId: item.id, quantity: input.quantity },
    });

    return transaction;
  }

  // Issue equipment
  static async issueEquipment(
    transactionId: string,
    input: IssueEquipmentInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const transaction = await prisma.equipmentTransaction.findUnique({
      where: { id: transactionId },
      include: { equipment: true, user: true },
    });

    if (!transaction) throw new NotFoundError('Equipment transaction not found');
    if (transaction.status !== EquipmentTransactionStatus.REQUESTED) {
      throw new BadRequestError(`Cannot issue transaction currently in status ${transaction.status}`);
    }

    const hasAccess = await checkDepartmentAccess(actorId, actorRole, transaction.equipment.departmentId);
    if (!hasAccess) throw new ForbiddenError('You do not have access to issue equipment from this department');

    if (transaction.equipment.quantityAvailable < transaction.quantity) {
      throw new ConflictError(
        `Insufficient available quantity. Available: ${transaction.equipment.quantityAvailable}, Requested: ${transaction.quantity}`
      );
    }

    // Atomically decrement available quantity and update transaction
    const [updatedTransaction] = await prisma.$transaction([
      prisma.equipmentTransaction.update({
        where: { id: transactionId },
        data: {
          status: EquipmentTransactionStatus.ISSUED,
          issuedById: actorId,
          notes: input.notes ? `${transaction.notes || ''} | Issued: ${input.notes}` : transaction.notes,
        },
        include: { equipment: true, user: true },
      }),
      prisma.equipment.update({
        where: { id: transaction.equipmentId },
        data: {
          quantityAvailable: { decrement: transaction.quantity },
        },
      }),
    ]);

    // Notify borrower
    await NotificationService.createNotification({
      userId: transaction.userId,
      title: 'Equipment Issued',
      message: `Your request for ${transaction.quantity}x ${transaction.equipment.name} has been issued. Expected return: ${transaction.expectedReturnDate.toDateString()}`,
      type: NotificationType.EQUIPMENT_ISSUED,
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'ISSUE_EQUIPMENT',
      entityType: 'EquipmentTransaction',
      entityId: transactionId,
      details: { quantity: transaction.quantity },
    });

    return updatedTransaction;
  }

  // Return equipment
  static async returnEquipment(
    transactionId: string,
    input: ReturnEquipmentInput,
    actorId: string,
    actorRole: Role,
    actorEmail: string
  ) {
    const transaction = await prisma.equipmentTransaction.findUnique({
      where: { id: transactionId },
      include: { equipment: true, user: true },
    });

    if (!transaction) throw new NotFoundError('Equipment transaction not found');
    if (transaction.status !== EquipmentTransactionStatus.ISSUED && transaction.status !== EquipmentTransactionStatus.OVERDUE) {
      throw new BadRequestError(`Cannot process return for transaction in status ${transaction.status}`);
    }

    const hasAccess = await checkDepartmentAccess(actorId, actorRole, transaction.equipment.departmentId);
    if (!hasAccess) throw new ForbiddenError('You do not have permission to accept equipment returns for this department');

    const returnStatus = input.status as EquipmentTransactionStatus;
    const shouldRestoreQuantity = returnStatus === EquipmentTransactionStatus.RETURNED || returnStatus === EquipmentTransactionStatus.DAMAGED_RETURN;

    const [updatedTransaction] = await prisma.$transaction([
      prisma.equipmentTransaction.update({
        where: { id: transactionId },
        data: {
          status: returnStatus,
          actualReturnDate: new Date(),
          conditionOnReturn: input.conditionOnReturn,
          notes: input.notes ? `${transaction.notes || ''} | Return: ${input.notes}` : transaction.notes,
        },
        include: { equipment: true, user: true },
      }),
      ...(shouldRestoreQuantity
        ? [
            prisma.equipment.update({
              where: { id: transaction.equipmentId },
              data: {
                quantityAvailable: { increment: transaction.quantity },
                condition: input.conditionOnReturn,
              },
            }),
          ]
        : []),
    ]);

    await NotificationService.createNotification({
      userId: transaction.userId,
      title: 'Equipment Return Recorded',
      message: `Return recorded for ${transaction.quantity}x ${transaction.equipment.name}. Status: ${returnStatus}`,
      type: NotificationType.SYSTEM,
    });

    await AuditService.recordLog({
      userId: actorId,
      userEmail: actorEmail,
      action: 'RETURN_EQUIPMENT',
      entityType: 'EquipmentTransaction',
      entityId: transactionId,
      details: { returnStatus, condition: input.conditionOnReturn },
    });

    return updatedTransaction;
  }

  // List transactions with overdue filtering
  static async listTransactions(query: {
    status?: EquipmentTransactionStatus;
    departmentId?: string;
    userId?: string;
    isOverdue?: string;
    page?: number;
    limit?: number;
  }, actorUser: { id: string; role: Role }) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 500, 1000);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.departmentId) where.equipment = { departmentId: query.departmentId };

    if (query.isOverdue === 'true') {
      where.status = EquipmentTransactionStatus.ISSUED;
      where.expectedReturnDate = { lt: new Date() };
    }

    if (actorUser.role === Role.STUDENT) {
      where.userId = actorUser.id;
    } else if (query.userId) {
      where.userId = query.userId;
    }

    const [total, transactions] = await Promise.all([
      prisma.equipmentTransaction.count({ where }),
      prisma.equipmentTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          equipment: {
            include: { department: { select: { id: true, name: true, code: true } } },
          },
          user: { select: { id: true, name: true, email: true, collegeId: true } },
          issuedBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      transactions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
