import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CryptoAsset,
  Prisma,
  ProofType,
  Transaction,
  TransactionProof,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
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
  accountName: 'XchangeNow Ltd',
};

// Fallback rates used when exchange_rates table has no recent row.
// RatesModule will replace this lookup later.
const FALLBACK_RATES: Record<CryptoAsset, { buy: string; sell: string }> = {
  BTC: { buy: '60000000.00', sell: '58000000.00' },
  ETH: { buy: '3500000.00', sell: '3400000.00' },
  USDT: { buy: '1500.00', sell: '1480.00' },
  USDC: { buy: '1500.00', sell: '1480.00' },
};

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
  ) {}

  // ============================== creation ==============================

  async createSell(userId: string, dto: CreateSellDto) {
    // SELL requires a default bank account (for the future payout).
    const defaultBank = await this.prisma.bankAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!defaultBank) {
      throw new BadRequestException(
        'Set a default bank account before selling crypto',
      );
    }

    const rate = await this.currentRate(dto.cryptoAsset, 'sell');
    const cryptoAmount = new Prisma.Decimal(dto.cryptoAmount);
    const fiatAmount = cryptoAmount.mul(rate);
    const wallet = await this.wallets.pickActiveWallet(
      dto.cryptoAsset,
      dto.network,
    );

    const tx = await this.prisma.transaction.create({
      data: {
        referenceCode: this.generateReferenceCode(),
        userId,
        type: TransactionType.SELL,
        status: TransactionStatus.PENDING,
        cryptoAsset: dto.cryptoAsset,
        network: dto.network,
        cryptoAmount,
        fiatAmount,
        fiatCurrency: 'NGN',
        rate,
        walletAddressId: wallet.id,
        expiresAt: new Date(Date.now() + TX_EXPIRY_MS),
      },
      include: { walletAddress: true },
    });
    this.logger.log(
      `SELL created ref=${tx.referenceCode} userId=${userId} ${dto.cryptoAmount} ${dto.cryptoAsset}`,
    );
    return tx;
  }

  async createSwap(userId: string, dto: CreateSwapDto) {
    if (dto.fromAsset === dto.toAsset) {
      throw new BadRequestException('fromAsset and toAsset must differ');
    }

    // Pair rate is derived from existing NGN-pegged rates:
    //   pairRate = fromAssetSellRate (we buy from user) / toAssetBuyRate (we sell to user)
    // The spread between buy/sell rates IS our swap fee, so users get slightly
    // less than the "fair" cross-rate. Same model real exchanges use.
    const fromSellRate = await this.currentRate(dto.fromAsset, 'sell');
    const toBuyRate = await this.currentRate(dto.toAsset, 'buy');
    const pairRate = fromSellRate.div(toBuyRate);

    const fromAmount = new Prisma.Decimal(dto.fromAmount);
    const toAmount = fromAmount.mul(pairRate);

    const wallet = await this.wallets.pickActiveWallet(
      dto.fromAsset,
      dto.fromNetwork,
    );

    const tx = await this.prisma.transaction.create({
      data: {
        referenceCode: this.generateReferenceCode(),
        userId,
        type: TransactionType.SWAP,
        status: TransactionStatus.PENDING,
        cryptoAsset: dto.fromAsset,
        network: dto.fromNetwork,
        cryptoAmount: fromAmount,
        toAsset: dto.toAsset,
        toNetwork: dto.toNetwork,
        toAmount,
        toAddress: dto.toAddress,
        rate: pairRate,
        // No fiat side for SWAP — fiatAmount/fiatCurrency stay null.
        walletAddressId: wallet.id,
        expiresAt: new Date(Date.now() + TX_EXPIRY_MS),
      },
      include: { walletAddress: true },
    });
    this.logger.log(
      `SWAP created ref=${tx.referenceCode} userId=${userId} ${dto.fromAmount} ${dto.fromAsset} → ${dto.toAsset}`,
    );
    return tx;
  }

  async createBuy(userId: string, dto: CreateBuyDto) {
    const rate = await this.currentRate(dto.cryptoAsset, 'buy');
    const fiatAmount = new Prisma.Decimal(dto.fiatAmount);
    const cryptoAmount = fiatAmount.div(rate);

    const tx = await this.prisma.transaction.create({
      data: {
        referenceCode: this.generateReferenceCode(),
        userId,
        type: TransactionType.BUY,
        status: TransactionStatus.AWAITING_PAYMENT,
        cryptoAsset: dto.cryptoAsset,
        network: dto.network,
        cryptoAmount,
        fiatAmount,
        fiatCurrency: 'NGN',
        rate,
        expiresAt: new Date(Date.now() + TX_EXPIRY_MS),
      },
    });
    this.logger.log(
      `BUY created ref=${tx.referenceCode} userId=${userId} ${dto.fiatAmount} NGN → ${dto.cryptoAsset}`,
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
      include: { proofs: true, walletAddress: true },
    });
    if (!tx || tx.userId !== userId) {
      // Same 404 for missing and not-yours, to avoid leaking existence.
      throw new NotFoundException('Transaction not found');
    }
    // BUY transactions need paymentInstructions on every read — a user
    // returning to the detail page after creation still has to see where
    // to send the bank transfer. Mirror what createBuy returns.
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

    // Each transaction type has an expected proof shape:
    //   SELL → user sent crypto to us → CRYPTO_TX_HASH
    //   SWAP → user sent FROM crypto to us → CRYPTO_TX_HASH
    //   BUY  → user sent fiat to us → BANK_TRANSFER_RECEIPT
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

    // Atomic: write the proof + advance state machine in one transaction.
    try {
      const result = await this.prisma.$transaction(async (db) => {
        const proof = await db.transactionProof.create({
          data: {
            transactionId: tx.id,
            type: dto.type,
            url: dto.value, // schema field is named `url`; stores hash or URL
            notes: dto.notes,
          },
        });

        const update: Prisma.TransactionUpdateInput = {
          status: TransactionStatus.UNDER_REVIEW,
        };
        // SELL + SWAP both submit an on-chain tx hash — persist it onto the
        // transaction row so admins can look it up without joining proofs.
        if (
          tx.type === TransactionType.SELL ||
          tx.type === TransactionType.SWAP
        ) {
          update.txHash = dto.value;
        }

        await db.transaction.update({
          where: { id: tx.id },
          data: update,
        });

        return proof;
      });
      this.logger.log(
        `Proof uploaded ref=${tx.referenceCode} type=${dto.type} → status=UNDER_REVIEW`,
      );
      return result;
    } catch (err) {
      // tx_hash is @unique system-wide. A collision = the user is submitting a
      // hash that's already been claimed (their own past tx or someone else's).
      // Surface a clear 409 instead of letting the raw Prisma error become a 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This transaction hash has already been submitted',
        );
      }
      throw err;
    }
  }

  // =============================== admin ===============================

  async listAll(query: ListTransactionsQueryDto) {
    return this.runList(query); // no userId enforcement
  }

  async findByIdAsAdmin(txId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { proofs: true, walletAddress: true, user: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    // Admins reviewing a BUY want to see the bank info that was shown to the
    // user (so they can match it against the uploaded receipt).
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
          approvedById: adminId, // admin is just a User with role=ADMIN
        },
      });

      // For SELL: auto-create a PENDING payout to the user's default bank account.
      // We snapshot the *current* default bank, not the one at creation time —
      // a future improvement is to lock the bank account id at SELL creation.
      if (tx.type === TransactionType.SELL) {
        // SELL transactions always carry fiat fields (set in createSell), but
        // the schema marks them nullable to accommodate SWAP. Guard for safety
        // and to let TS narrow the types below.
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
            // Payout reference mirrors the transaction's referenceCode for
            // easy bank-side matching.
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

  /**
   * Manually transition APPROVED -> COMPLETED for BUY/SWAP transactions.
   * SELL is excluded: it completes automatically when its Payout flips to PAID.
   */
  async markCompleted(
    adminId: string,
    txId: string,
    dto: MarkCompletedDto,
  ): Promise<Transaction> {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Transaction not found');

    if (tx.status !== TransactionStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot mark COMPLETED from status ${tx.status}; expected APPROVED`,
      );
    }

    if (tx.type === TransactionType.SELL) {
      // The PayoutsService cascades SELL -> COMPLETED on payout PAID.
      // Letting admins double-complete here would skip the payout flow.
      throw new BadRequestException(
        'SELL transactions complete via payout PAID, not this endpoint',
      );
    }

    if (!dto.outboundTxHash) {
      throw new BadRequestException(
        `${tx.type} requires outboundTxHash to record the crypto sent to the user`,
      );
    }
    // Capture the narrowed (non-undefined) value — TS can't carry the
    // narrowing into the async closure below.
    const outboundTxHash = dto.outboundTxHash;

    return this.prisma.$transaction(async (db) => {
      const updated = await db.transaction.update({
        where: { id: txId },
        data: {
          status: TransactionStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // Store the outbound hash as a TransactionProof.
      // ProofType.OTHER because user-side proof types are CRYPTO_TX_HASH (SELL/SWAP
      // incoming) and BANK_TRANSFER_RECEIPT (BUY incoming); an admin-recorded
      // OUTGOING hash semantically doesn't match either. Notes carry the context.
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
      throw new BadRequestException(
        `Cannot reject from status ${tx.status}`,
      );
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
          metadata: {
            by: adminId,
            transactionId: txId,
            reason: dto.reason,
          } as never,
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
   * available to the frontend on every read so the user can see "where to pay"
   * after navigating back to the detail page (or copy the reference again
   * before initiating their transfer). This is reference data — recomputed on
   * the fly from COMPANY_BANK + tx.referenceCode rather than stored on the row.
   *
   * SELL/SWAP are returned unchanged — the company wallet address lives on
   * the `walletAddress` relation, not `paymentInstructions`.
   *
   * Generic so the caller's narrow type survives the wrap (Transaction stays
   * Transaction, Transaction & { user: User } stays that).
   */
  private attachPaymentInstructions<
    T extends { type: TransactionType; referenceCode: string },
  >(tx: T): T | (T & { paymentInstructions: typeof COMPANY_BANK & { reference: string } }) {
    if (tx.type !== TransactionType.BUY) return tx;
    return {
      ...tx,
      paymentInstructions: {
        ...COMPANY_BANK,
        reference: tx.referenceCode,
      },
    };
  }

  private async runList(query: ListTransactionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.TransactionWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.asset ? { cryptoAsset: query.asset } : {}),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: { proofs: true, walletAddress: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { transactions, total, page, pageSize };
  }

  private async currentRate(
    asset: CryptoAsset,
    side: 'buy' | 'sell',
  ): Promise<Prisma.Decimal> {
    // Pick the most recent rate for this asset (NGN side). Within the last
    // hour to bound staleness — older rates fall back to the hardcoded table.
    const recent = await this.prisma.exchangeRate.findFirst({
      where: {
        asset,
        fiatCurrency: 'NGN',
        fetchedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      orderBy: { fetchedAt: 'desc' },
    });
    if (recent) {
      return side === 'buy' ? recent.buyRate : recent.sellRate;
    }

    const fallback = FALLBACK_RATES[asset];
    return new Prisma.Decimal(side === 'buy' ? fallback.buy : fallback.sell);
  }

  /**
   * User-facing reference of the form XCN-XXXXXXXX. 8 hex chars = 4 billion
   * combos — collision risk is negligible. If it ever does collide, Prisma's
   * @unique on the column raises P2002 and the request fails (acceptable
   * given the odds; we can add retry logic if it ever becomes a real concern).
   */
  private generateReferenceCode(): string {
    return 'XCN-' + randomBytes(4).toString('hex').toUpperCase();
  }
}
