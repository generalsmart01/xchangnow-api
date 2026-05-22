import {
  BadRequestException,
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
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
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

    return this.prisma.transaction.create({
      data: {
        referenceCode: this.generateReferenceCode(),
        userId,
        type: TransactionType.SELL,
        status: TransactionStatus.PENDING,
        cryptoAsset: dto.cryptoAsset,
        network: dto.network,
        cryptoAmount,
        fiatAmount,
        rate,
        walletAddressId: wallet.id,
        expiresAt: new Date(Date.now() + TX_EXPIRY_MS),
      },
      include: { walletAddress: true },
    });
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
        rate,
        expiresAt: new Date(Date.now() + TX_EXPIRY_MS),
      },
    });

    // Return company bank details + the transaction's reference code so the
    // user can put it in the bank transfer narration for admin matching.
    return {
      ...tx,
      paymentInstructions: {
        ...COMPANY_BANK,
        reference: tx.referenceCode,
      },
    };
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
    return tx;
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

    // Enforce proof type matches transaction type.
    if (
      tx.type === TransactionType.SELL &&
      dto.type !== ProofType.CRYPTO_TX_HASH
    ) {
      throw new BadRequestException(
        'SELL transactions require CRYPTO_TX_HASH proof',
      );
    }
    if (
      tx.type === TransactionType.BUY &&
      dto.type !== ProofType.BANK_TRANSFER_RECEIPT
    ) {
      throw new BadRequestException(
        'BUY transactions require BANK_TRANSFER_RECEIPT proof',
      );
    }

    // Atomic: write the proof + advance state machine in one transaction.
    return this.prisma.$transaction(async (db) => {
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
      if (tx.type === TransactionType.SELL) {
        update.txHash = dto.value;
      }

      await db.transaction.update({
        where: { id: tx.id },
        data: update,
      });

      return proof;
    });
  }

  // =============================== admin ===============================

  async listAll(query: ListTransactionsQueryDto) {
    return this.runList(query); // no userId enforcement
  }

  async findByIdAsAdmin(txId: string): Promise<Transaction> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      include: { proofs: true, walletAddress: true, user: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    return tx;
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

      return updated;
    });
  }

  // ============================ internals ============================

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
    const recent = await this.prisma.exchangeRate.findFirst({
      where: {
        asset,
        fetchedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // within last hour
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
