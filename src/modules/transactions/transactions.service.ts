// src/modules/transactions/transactions.service.ts

/**
 * The transaction lifecycle owner. Three transaction types share one model:
 *
 *   BUY   user pays fiat → we send crypto      (AWAITING_PAYMENT → UNDER_REVIEW → ...)
 *   SELL  user sends crypto → we pay fiat      (PENDING → UNDER_REVIEW → ... → Payout)
 *   SWAP  user sends crypto A → we send crypto B  (PENDING → UNDER_REVIEW → ...)
 *
 * Assets and networks are referenced via a single AssetNetwork FK
 * (`assetNetworkId`, plus `toAssetNetworkId` for SWAP) instead of separate
 * enum columns. One FK guarantees the (asset, network) combination is
 * valid by construction.
 *
 * Public surface, by concern:
 *
 *   Creation (customer):
 *     - createSell      requires default bank + active wallet for the pair
 *     - createBuy       returns paymentInstructions (bank to pay)
 *     - createSwap      requires different from/to ASSETS (not just pairs)
 *
 *   Customer reads:
 *     - listMine        paginated history, scoped to caller
 *     - findMine        single transaction; BUY includes paymentInstructions
 *
 *   Customer state change:
 *     - uploadProof     proof + state machine advance (atomic)
 *
 *   Admin reads:
 *     - listAll         cross-user
 *     - findByIdAsAdmin  includes user + proofs
 *
 *   Admin state changes:
 *     - approve         UNDER_REVIEW → APPROVED (SELL: also creates Payout)
 *     - reject          → REJECTED with rejectedReason
 *     - markCompleted   APPROVED → COMPLETED for BUY/SWAP (records outbound tx hash)
 *                       NB: SELL completes via Payout PAID, not this method
 *
 * Rate sourcing:
 *   - Rates are looked up by assetId (per asset, not per pair).
 *   - If no rate within the last hour exists for an asset, transactions are
 *     REJECTED (503). Admin must POST a rate snapshot first. The previous
 *     hardcoded FALLBACK_RATES table was removed — dynamic asset list can't
 *     be hardcoded, and silently using stale rates is dangerous.
 *
 * Invariants the service enforces:
 *   - Fiat amounts computed server-side from rates (never trust client)
 *   - txHash unique system-wide (anti-replay — P2002 caught + surfaced as 409)
 *   - Every state transition is atomic with its side effects (creating a
 *     Payout, writing UserActivityLog, etc. — all in `prisma.$transaction`)
 *   - 30-minute expiry on PENDING/AWAITING_PAYMENT; cron-cleanup (future) marks
 *     unacted tx as EXPIRED
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  ProofType,
  Transaction,
  TransactionProof,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { computeReferralCommission } from '../../common/utils/compute-referral-commission';
import { PrismaService } from '../../database/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { ApproveTransactionDto } from './dto/approve-transaction.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { CreateSellDto } from './dto/create-sell.dto';
import { CreateSwapDto } from './dto/create-swap.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { MarkCompletedDto } from './dto/mark-completed.dto';
import { RejectTransactionDto } from './dto/reject-transaction.dto';
import { UploadProofDto } from './dto/upload-proof.dto';

const TX_EXPIRY_MS = 30 * 60 * 1000; // 30 min to act before auto-expire

// Hardcoded company bank details for BUY flow.
// In production this would come from a settings table / KMS.
const COMPANY_BANK = {
  bankName: 'Wema Bank',
  accountNumber: '0123456789',
  accountName: 'XchangNow Ltd',
};

// Shared include for transaction reads — embeds the AssetNetwork chain
// (asset + network details) on both the primary and toAssetNetwork slots
// so the response is self-contained for the frontend.
const TX_INCLUDE = {
  proofs: true,
  walletAddress: true,
  assetNetwork: {
    include: {
      asset: { select: { id: true, symbol: true, name: true, decimals: true, iconUrl: true } },
      network: { select: { id: true, code: true, name: true, chainId: true } },
    },
  },
  toAssetNetwork: {
    include: {
      asset: { select: { id: true, symbol: true, name: true, decimals: true, iconUrl: true } },
      network: { select: { id: true, code: true, name: true, chainId: true } },
    },
  },
} as const;

type ResolvedAssetNetwork = Prisma.AssetNetworkGetPayload<{
  include: { asset: true; network: true };
}>;

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
  ) {}

  // ============================== creation ==============================

  async createSell(userId: string, dto: CreateSellDto) {
    const defaultBank = await this.prisma.bankAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!defaultBank) {
      throw new BadRequestException('Set a default bank account before selling crypto');
    }

    const pair = await this.resolvePair(dto.assetNetworkId);
    const rate = await this.currentRate(pair.assetId, 'sell');
    const cryptoAmount = new Prisma.Decimal(dto.cryptoAmount);
    const fiatAmount = cryptoAmount.mul(rate);
    const wallet = await this.wallets.pickActiveWallet(pair.id);

    const tx = await this.prisma.transaction.create({
      data: {
        referenceCode: this.generateReferenceCode(),
        userId,
        type: TransactionType.SELL,
        status: TransactionStatus.PENDING,
        assetNetworkId: pair.id,
        cryptoAmount,
        fiatAmount,
        fiatCurrency: 'NGN',
        rate,
        walletAddressId: wallet.id,
        expiresAt: new Date(Date.now() + TX_EXPIRY_MS),
      },
      include: TX_INCLUDE,
    });
    this.logger.log(
      `SELL created ref=${tx.referenceCode} userId=${userId} ${dto.cryptoAmount} ${pair.asset.symbol} on ${pair.network.code}`,
    );
    return tx;
  }

  async createSwap(userId: string, dto: CreateSwapDto) {
    if (dto.fromAssetNetworkId === dto.toAssetNetworkId) {
      throw new BadRequestException('fromAssetNetworkId and toAssetNetworkId must differ');
    }

    const [fromPair, toPair] = await Promise.all([
      this.resolvePair(dto.fromAssetNetworkId),
      this.resolvePair(dto.toAssetNetworkId),
    ]);

    if (fromPair.assetId === toPair.assetId) {
      // Same asset, different networks = bridging. Not supported in this version.
      throw new BadRequestException(
        'Cross-network bridging of the same asset is not supported. fromAsset and toAsset must differ.',
      );
    }

    // Pair rate derived from the two NGN-pegged rates:
    //   pairRate = fromAssetSellRate (we buy from user) / toAssetBuyRate (we sell to user)
    const fromSellRate = await this.currentRate(fromPair.assetId, 'sell');
    const toBuyRate = await this.currentRate(toPair.assetId, 'buy');
    const pairRate = fromSellRate.div(toBuyRate);

    const fromAmount = new Prisma.Decimal(dto.fromAmount);
    const toAmount = fromAmount.mul(pairRate);

    const wallet = await this.wallets.pickActiveWallet(fromPair.id);

    const tx = await this.prisma.transaction.create({
      data: {
        referenceCode: this.generateReferenceCode(),
        userId,
        type: TransactionType.SWAP,
        status: TransactionStatus.PENDING,
        assetNetworkId: fromPair.id,
        cryptoAmount: fromAmount,
        toAssetNetworkId: toPair.id,
        toAmount,
        toAddress: dto.toAddress,
        rate: pairRate,
        walletAddressId: wallet.id,
        expiresAt: new Date(Date.now() + TX_EXPIRY_MS),
      },
      include: TX_INCLUDE,
    });
    this.logger.log(
      `SWAP created ref=${tx.referenceCode} userId=${userId} ${dto.fromAmount} ${fromPair.asset.symbol}/${fromPair.network.code} → ${toPair.asset.symbol}/${toPair.network.code}`,
    );
    return tx;
  }

  async createBuy(userId: string, dto: CreateBuyDto) {
    const pair = await this.resolvePair(dto.assetNetworkId);
    const rate = await this.currentRate(pair.assetId, 'buy');
    const fiatAmount = new Prisma.Decimal(dto.fiatAmount);
    const cryptoAmount = fiatAmount.div(rate);

    const tx = await this.prisma.transaction.create({
      data: {
        referenceCode: this.generateReferenceCode(),
        userId,
        type: TransactionType.BUY,
        status: TransactionStatus.AWAITING_PAYMENT,
        assetNetworkId: pair.id,
        cryptoAmount,
        fiatAmount,
        fiatCurrency: 'NGN',
        rate,
        expiresAt: new Date(Date.now() + TX_EXPIRY_MS),
      },
      include: TX_INCLUDE,
    });
    this.logger.log(
      `BUY created ref=${tx.referenceCode} userId=${userId} ${dto.fiatAmount} NGN → ${pair.asset.symbol} on ${pair.network.code}`,
    );

    return this.attachPaymentInstructions(tx);
  }

  // =============================== reads ===============================

  async listMine(userId: string, query: ListTransactionsQueryDto) {
    return this.runList({ ...query, userId });
  }

  async findMine(userId: string, txId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: TX_INCLUDE,
    });
    if (!tx || tx.userId !== userId) {
      throw new NotFoundException('Transaction not found');
    }
    return this.attachPaymentInstructions(tx);
  }

  // ============================ proof upload ============================

  async uploadProof(
    userId: string,
    txId: string,
    dto: UploadProofDto,
  ): Promise<TransactionProof> {
    const tx = await this.findMine(userId, txId);

    if (
      tx.status !== TransactionStatus.PENDING &&
      tx.status !== TransactionStatus.AWAITING_PAYMENT
    ) {
      throw new BadRequestException(
        `Cannot upload proof for transaction in status ${tx.status}`,
      );
    }

    const requiredProof: Record<TransactionType, ProofType> = {
      [TransactionType.SELL]: ProofType.CRYPTO_TX_HASH,
      [TransactionType.SWAP]: ProofType.CRYPTO_TX_HASH,
      [TransactionType.BUY]: ProofType.BANK_TRANSFER_RECEIPT,
    };
    if (dto.type !== requiredProof[tx.type]) {
      throw new BadRequestException(
        `${tx.type} transactions require ${requiredProof[tx.type]} proof`,
      );
    }

    try {
      const result = await this.prisma.$transaction(async (db) => {
        const proof = await db.transactionProof.create({
          data: {
            transactionId: tx.id,
            type: dto.type,
            url: dto.value,
            notes: dto.notes,
          },
        });

        const update: Prisma.TransactionUpdateInput = {
          status: TransactionStatus.UNDER_REVIEW,
        };
        if (
          tx.type === TransactionType.SELL ||
          tx.type === TransactionType.SWAP
        ) {
          update.txHash = dto.value;
        }

        await db.transaction.update({ where: { id: tx.id }, data: update });

        return proof;
      });
      this.logger.log(
        `Proof uploaded ref=${tx.referenceCode} type=${dto.type} → status=UNDER_REVIEW`,
      );
      return result;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('This transaction hash has already been submitted');
      }
      throw err;
    }
  }

  // =============================== admin ===============================

  async listAll(query: ListTransactionsQueryDto) {
    return this.runList(query);
  }

  async findByIdAsAdmin(txId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { ...TX_INCLUDE, user: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    return this.attachPaymentInstructions(tx);
  }

  async approve(
    adminId: string,
    txId: string,
    _dto: ApproveTransactionDto,
  ): Promise<Transaction> {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Transaction not found');

    if (tx.status !== TransactionStatus.UNDER_REVIEW) {
      throw new BadRequestException(
        `Cannot approve from status ${tx.status}; expected UNDER_REVIEW`,
      );
    }

    return this.prisma.$transaction(async (db) => {
      const updated = await db.transaction.update({
        where: { id: txId },
        data: {
          status: TransactionStatus.APPROVED,
          approvedAt: new Date(),
          approvedById: adminId,
        },
      });

      if (tx.type === TransactionType.SELL) {
        if (tx.fiatAmount === null || tx.fiatCurrency === null) {
          throw new BadRequestException(
            'SELL transaction is missing fiat fields; data integrity error',
          );
        }
        const bank = await db.bankAccount.findFirst({
          where: { userId: tx.userId, isDefault: true },
        });
        if (!bank) {
          throw new BadRequestException(
            'User no longer has a default bank account; cannot create payout',
          );
        }
        await db.payout.create({
          data: {
            transactionId: txId,
            bankAccountId: bank.id,
            amount: tx.fiatAmount,
            currency: tx.fiatCurrency,
            reference: tx.referenceCode,
          },
        });
      }

      await db.userActivityLog.create({
        data: {
          userId: tx.userId,
          action: 'TRANSACTION_APPROVED',
          metadata: { by: adminId, transactionId: txId } as never,
        },
      });

      this.logger.log(
        `Transaction APPROVED ref=${tx.referenceCode} type=${tx.type} by adminId=${adminId}` +
          (tx.type === TransactionType.SELL ? ' (payout PENDING created)' : ''),
      );

      return updated;
    });
  }

  async markCompleted(
    adminId: string,
    txId: string,
    dto: MarkCompletedDto,
  ): Promise<Transaction> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { user: { select: { referredById: true } } },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    if (tx.status !== TransactionStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot mark COMPLETED from status ${tx.status}; expected APPROVED`,
      );
    }

    if (tx.type === TransactionType.SELL) {
      throw new BadRequestException(
        'SELL transactions complete via payout PAID, not this endpoint',
      );
    }

    if (!dto.outboundTxHash) {
      throw new BadRequestException(
        `${tx.type} requires outboundTxHash to record the crypto sent to the user`,
      );
    }
    const outboundTxHash = dto.outboundTxHash;

    return this.prisma.$transaction(async (db) => {
      const updated = await db.transaction.update({
        where: { id: txId },
        data: {
          status: TransactionStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      await db.transactionProof.create({
        data: {
          transactionId: txId,
          type: ProofType.OTHER,
          url: outboundTxHash,
          notes: dto.notes
            ? `Outbound (admin-sent) tx hash. ${dto.notes}`
            : 'Outbound (admin-sent) tx hash',
        },
      });

      await db.userActivityLog.create({
        data: {
          userId: tx.userId,
          action: 'TRANSACTION_COMPLETED',
          metadata: {
            by: adminId,
            transactionId: txId,
            outboundTxHash,
          } as never,
        },
      });

      const commission = computeReferralCommission({
        transactionId: tx.id,
        refereeId: tx.userId,
        refereeReferredById: tx.user.referredById,
        transactionType: tx.type,
        fiatAmount: tx.fiatAmount,
      });
      if (commission) {
        await db.referralCommission.create({ data: commission });
        this.logger.log(
          `Referral commission credited ref=${tx.referenceCode} ` +
            `referrerId=${commission.referrerId} amount=${commission.amount.toFixed(2)} NGN`,
        );
      }

      this.logger.log(
        `Transaction COMPLETED ref=${tx.referenceCode} type=${tx.type} by adminId=${adminId}`,
      );

      return updated;
    });
  }

  async reject(
    adminId: string,
    txId: string,
    dto: RejectTransactionDto,
  ): Promise<Transaction> {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Transaction not found');

    const allowedFrom: TransactionStatus[] = [
      TransactionStatus.PENDING,
      TransactionStatus.AWAITING_PAYMENT,
      TransactionStatus.UNDER_REVIEW,
    ];
    if (!allowedFrom.includes(tx.status)) {
      throw new BadRequestException(`Cannot reject from status ${tx.status}`);
    }

    return this.prisma.$transaction(async (db) => {
      const updated = await db.transaction.update({
        where: { id: txId },
        data: {
          status: TransactionStatus.REJECTED,
          rejectedReason: dto.reason,
        },
      });

      await db.userActivityLog.create({
        data: {
          userId: tx.userId,
          action: 'TRANSACTION_REJECTED',
          metadata: { by: adminId, transactionId: txId, reason: dto.reason } as never,
        },
      });

      this.logger.warn(
        `Transaction REJECTED ref=${tx.referenceCode} type=${tx.type} by adminId=${adminId} reason="${dto.reason}"`,
      );

      return updated;
    });
  }

  // ============================ internals ============================

  /**
   * BUY transactions need the company bank details + transaction reference
   * on every read. Generic so the caller's narrow type survives the wrap.
   */
  private attachPaymentInstructions<
    T extends { type: TransactionType; referenceCode: string },
  >(tx: T): T | (T & { paymentInstructions: typeof COMPANY_BANK & { reference: string } }) {
    if (tx.type !== TransactionType.BUY) return tx;
    return {
      ...tx,
      paymentInstructions: { ...COMPANY_BANK, reference: tx.referenceCode },
    };
  }

  private async runList(query: ListTransactionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.TransactionWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.assetNetworkId ? { assetNetworkId: query.assetNetworkId } : {}),
      ...(query.assetId && !query.assetNetworkId
        ? { assetNetwork: { assetId: query.assetId } }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: TX_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { transactions, total, page, pageSize };
  }

  /**
   * Look up the most recent rate (within the last hour) for the given asset.
   * Throws 503 if no recent rate exists — admin must POST a snapshot via
   * /rates before users can transact this asset. The previous hardcoded
   * fallback table was removed (dynamic asset list can't be hardcoded, and
   * silently using stale rates is dangerous).
   */
  private async currentRate(
    assetId: string,
    side: 'buy' | 'sell',
  ): Promise<Prisma.Decimal> {
    const recent = await this.prisma.exchangeRate.findFirst({
      where: {
        assetId,
        fiatCurrency: 'NGN',
        fetchedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      orderBy: { fetchedAt: 'desc' },
      include: { asset: { select: { symbol: true } } },
    });
    if (!recent) {
      throw new ServiceUnavailableException(
        'No recent rate available for this asset. Try again shortly.',
      );
    }
    return side === 'buy' ? recent.buyRate : recent.sellRate;
  }

  /**
   * Load and validate an AssetNetwork pair by id. Throws 400 if the pair
   * doesn't exist or is disabled. Returned shape includes the embedded
   * asset + network for downstream use (logging, response building).
   */
  private async resolvePair(assetNetworkId: string): Promise<ResolvedAssetNetwork> {
    const pair = await this.prisma.assetNetwork.findUnique({
      where: { id: assetNetworkId },
      include: { asset: true, network: true },
    });
    if (!pair) {
      throw new BadRequestException(`assetNetworkId "${assetNetworkId}" does not exist`);
    }
    if (!pair.isEnabled) {
      throw new BadRequestException(
        `Pair ${pair.asset.symbol}/${pair.network.code} is disabled`,
      );
    }
    if (!pair.asset.isEnabled) {
      throw new BadRequestException(`Asset ${pair.asset.symbol} is disabled`);
    }
    if (!pair.network.isEnabled) {
      throw new BadRequestException(`Network ${pair.network.code} is disabled`);
    }
    return pair;
  }

  /**
   * User-facing reference of the form XCN-XXXXXXXX. 8 hex chars = 4 billion
   * combinations, plenty for our volume. Collision risk: P(collision)
   * crosses 1% around 9k existing references — by then we'd add a uniqueness
   * retry.
   */
  private generateReferenceCode(): string {
    return `XCN-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}
