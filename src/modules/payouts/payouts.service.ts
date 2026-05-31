// src/modules/payouts/payouts.service.ts

/**
 * Owns the Payout state machine and the cascade to Transaction on PAID.
 *
 * State machine (declared in ALLOWED_TRANSITIONS below):
 *   PENDING    → PROCESSING | PAID | FAILED
 *   PROCESSING → PAID | FAILED
 *   FAILED     → PENDING (retry)
 *   PAID       → (terminal — refuses all transitions)
 *
 * Side effects per transition:
 *   → PROCESSING: stamp processedById + processedAt
 *   → PAID:       stamp paidAt AND cascade Transaction to COMPLETED (atomic)
 *   → FAILED:     stamp failureReason
 *
 * The cascade on PAID writes Transaction directly (not via
 * TransactionsService) to avoid a circular module dependency. The matching
 * column update is the ONLY direct cross-module DB write in the system —
 * documented here to make it obvious.
 *
 * Every status change is also recorded in user_activity_logs
 * (PAYOUT_<status>) with the admin id + reason in metadata.
 */

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
import { computeReferralCommission } from '../../common/utils/compute-referral-commission';
import {
  BankAccountMasked,
  maskBankAccount,
} from '../../common/utils/mask-pii';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { UpdatePayoutStatusDto } from './dto/update-payout-status.dto';

// Payouts returned to admins have the embedded bank account masked
// (accountNumberMasked instead of accountNumber) — see PII rulebook §29.
type PayoutAdminView = Omit<Payout, 'bankAccount'> & {
  bankAccount: BankAccountMasked;
};

// Allowed transitions for the payout state machine.
const ALLOWED_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  PENDING: [PayoutStatus.PROCESSING, PayoutStatus.PAID, PayoutStatus.FAILED],
  PROCESSING: [PayoutStatus.PAID, PayoutStatus.FAILED],
  FAILED: [PayoutStatus.PENDING], // retry
  PAID: [], // terminal
};

/**
 * PayoutsService — the single point of truth for "is this payout
 * transition legal?" plus the cascade to its parent transaction on PAID.
 * Customer-side methods are read-only (`listMine`, `findMine`); writes are
 * admin-only via `updateStatus`.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ============================== reads ==============================

  async listMine(userId: string, query: ListPayoutsQueryDto) {
    return this.runList({ ...query, userId });
  }

  /**
   * Admin-side paginated payout listing. Mirrors `listMine` but returns
   * the masked-bank-account shape — admins reviewing payouts in bulk have
   * no operational need for raw account numbers; masking is the default
   * per the PII rulebook §29. The payout-processing step that DOES need
   * the full account number should fetch it explicitly through a separate
   * code path (not yet built).
   */
  async listAll(query: ListPayoutsQueryDto) {
    const result = await this.runList(query);
    return {
      ...result,
      payouts: result.payouts.map((p) => ({
        ...p,
        bankAccount: maskBankAccount(p.bankAccount),
      })),
    };
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

  /**
   * Admin reads a single payout including transaction + bank account. The
   * embedded bank account is MASKED (accountNumberMasked instead of
   * accountNumber). See `listAll` for the same rationale.
   */
  async findByIdAsAdmin(id: string): Promise<PayoutAdminView> {
    const payout = await this.prisma.payout.findUnique({
      where: { id },
      include: { transaction: true, bankAccount: true },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    return {
      ...payout,
      bankAccount: maskBankAccount(payout.bankAccount),
    };
  }

  // =========================== state machine ===========================

  /**
   * Transition a payout's status. All writes happen in one
   * `prisma.$transaction` so the payout update, the side-effect column
   * stamps (processedAt/paidAt/failureReason), the cascade to Transaction
   * on PAID, the user_activity_log row, and (on PAID) the referral
   * commission credit all land together or not at all.
   *
   * On → PAID specifically:
   *   - paidAt stamped
   *   - parent Transaction cascades APPROVED → COMPLETED, completedAt stamped
   *   - if the SELL'er has a referrer, a ReferralCommission row is created
   *     (0.1% of fiatAmount — same rule as transactions.markCompleted uses
   *     for BUY)
   *
   * @throws BadRequestException 400 — illegal state transition (see
   *   ALLOWED_TRANSITIONS at top of file)
   * @throws NotFoundException 404 — payout not found
   */
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

        // Referral commission credit for SELL — atomic with the cascade above.
        // Load tx with referrer info; computeReferralCommission returns null
        // (and we skip) if there's no referrer or no fiat basis.
        const txForCommission = await db.transaction.findUnique({
          where: { id: payout.transactionId },
          select: {
            id: true,
            userId: true,
            type: true,
            fiatAmount: true,
            referenceCode: true,
            user: { select: { referredById: true } },
          },
        });
        if (txForCommission) {
          const commission = computeReferralCommission({
            transactionId: txForCommission.id,
            refereeId: txForCommission.userId,
            refereeReferredById: txForCommission.user.referredById,
            transactionType: txForCommission.type,
            fiatAmount: txForCommission.fiatAmount,
          });
          if (commission) {
            await db.referralCommission.create({ data: commission });
            this.logger.log(
              `Referral commission credited ref=${txForCommission.referenceCode} ` +
                `referrerId=${commission.referrerId} amount=${commission.amount.toFixed(2)} NGN`,
            );
          }
        }
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
