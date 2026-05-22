import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Payout,
  PayoutStatus,
  Prisma,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { UpdatePayoutStatusDto } from './dto/update-payout-status.dto';

// Allowed transitions for the payout state machine.
const ALLOWED_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  PENDING: [PayoutStatus.PROCESSING, PayoutStatus.PAID, PayoutStatus.FAILED],
  PROCESSING: [PayoutStatus.PAID, PayoutStatus.FAILED],
  FAILED: [PayoutStatus.PENDING], // retry
  PAID: [], // terminal
};

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ============================== reads ==============================

  async listMine(userId: string, query: ListPayoutsQueryDto) {
    return this.runList({ ...query, userId });
  }

  async listAll(query: ListPayoutsQueryDto) {
    return this.runList(query);
  }

  async findMine(userId: string, id: string): Promise<Payout> {
    const payout = await this.prisma.payout.findUnique({
      where: { id },
      include: { transaction: true, bankAccount: true },
    });
    if (!payout || payout.transaction.userId !== userId) {
      // 404 hides existence
      throw new NotFoundException('Payout not found');
    }
    return payout;
  }

  async findByIdAsAdmin(id: string): Promise<Payout> {
    const payout = await this.prisma.payout.findUnique({
      where: { id },
      include: { transaction: true, bankAccount: true },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }

  // =========================== state machine ===========================

  async updateStatus(
    adminId: string,
    payoutId: string,
    dto: UpdatePayoutStatusDto,
  ): Promise<Payout> {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw new NotFoundException('Payout not found');

    const allowed = ALLOWED_TRANSITIONS[payout.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition payout from ${payout.status} to ${dto.status}`,
      );
    }

    const now = new Date();

    return this.prisma.$transaction(async (db) => {
      const updated = await db.payout.update({
        where: { id: payoutId },
        data: {
          status: dto.status,
          failureReason:
            dto.status === PayoutStatus.FAILED
              ? (dto.failureReason ?? 'No reason provided')
              : null,
          reference: dto.reference ?? payout.reference,
          // processedAt = the moment the admin started moving this (PENDING → PROCESSING)
          processedAt:
            dto.status === PayoutStatus.PROCESSING && !payout.processedAt
              ? now
              : payout.processedAt,
          processedById:
            dto.status === PayoutStatus.PROCESSING && !payout.processedById
              ? adminId
              : payout.processedById,
          // paidAt = the moment the transfer was confirmed PAID
          paidAt: dto.status === PayoutStatus.PAID ? now : null,
        },
      });

      // When payout reaches PAID, transition the parent transaction to
      // COMPLETED and stamp its completedAt. Direct prisma update (not via
      // TransactionsService) to avoid circular module dependency.
      if (dto.status === PayoutStatus.PAID) {
        await db.transaction.updateMany({
          where: {
            id: payout.transactionId,
            status: TransactionStatus.APPROVED,
          },
          data: {
            status: TransactionStatus.COMPLETED,
            completedAt: now,
          },
        });
      }

      // Audit on the user that owns this payout's transaction
      const tx = await db.transaction.findUnique({
        where: { id: payout.transactionId },
        select: { userId: true },
      });
      if (tx) {
        await db.userActivityLog.create({
          data: {
            userId: tx.userId,
            action: `PAYOUT_${dto.status}`,
            metadata: {
              by: adminId,
              payoutId,
              transactionId: payout.transactionId,
              ...(dto.failureReason ? { reason: dto.failureReason } : {}),
            } as never,
          },
        });
      }

      // Use WARN for FAILED so it stands out yellow in the terminal; PAID is
      // worth highlighting too because it cascades to Transaction COMPLETED.
      const severity =
        dto.status === PayoutStatus.FAILED
          ? 'warn'
          : ('log' as 'log' | 'warn');
      this.logger[severity](
        `Payout ${payout.status} → ${dto.status} ref=${payout.reference} adminId=${adminId}` +
          (dto.status === PayoutStatus.PAID
            ? ' (Transaction → COMPLETED)'
            : '') +
          (dto.failureReason ? ` reason="${dto.failureReason}"` : ''),
      );

      return updated;
    });
  }

  // ============================ internals ============================

  private async runList(query: ListPayoutsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.PayoutWhereInput = {
      ...(query.userId ? { transaction: { userId: query.userId } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [payouts, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        include: { transaction: true, bankAccount: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payout.count({ where }),
    ]);

    return { payouts, total, page, pageSize };
  }
}
