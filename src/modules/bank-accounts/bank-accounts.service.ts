// src/modules/bank-accounts/bank-accounts.service.ts

/**
 * BankAccountsService — CRUD over the caller's bank accounts.
 *
 * Why a dedicated module (separate from UsersService):
 *   - Bank accounts are FINANCIAL PII (rulebook §25 tier 3). They have
 *     stricter handling than profile fields: masked in admin responses
 *     (see PayoutsService.findByIdAsAdmin), referenced by Payouts,
 *     cannot be hard-deleted while payouts exist.
 *   - Their own state-machine-like invariant: exactly zero or one default
 *     bank account per user. The atomic re-assignment lives here, not
 *     buried in a UsersService method.
 *   - PayoutsModule already consumes bank accounts via DB relations; a
 *     dedicated module keeps the boundary clear.
 *
 * Public surface (all caller-scoped — no admin reads here yet):
 *   - listMine(userId)
 *   - create(userId, dto)
 *   - update(userId, accountId, dto)
 *   - delete(userId, accountId)
 *
 * Default-account invariant: at most ONE row per user with `isDefault=true`.
 * Maintained by the atomic re-assignment inside create() and update() —
 * setting `isDefault=true` first un-flags any existing default, then writes
 * the new row, both inside one `prisma.$transaction`. Concurrent writes
 * can't break it.
 */

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankAccount, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Caller's bank accounts, default first, then oldest first within the rest.
   */
  listMine(userId: string): Promise<BankAccount[]> {
    return this.prisma.bankAccount.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Add a bank account for the caller. If `isDefault=true`, atomically
   * un-sets the previous default in the same transaction — the
   * "at-most-one-default" invariant never breaks even under concurrent
   * writes.
   *
   * @throws ConflictException 409 — duplicate (userId, bankName,
   *   accountNumber). Uniqueness lives on the tuple, not just account
   *   number — same number at different banks is OK.
   */
  async create(
    userId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccount> {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.bankAccount.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      try {
        return await tx.bankAccount.create({
          data: {
            userId,
            bankName: dto.bankName,
            accountNumber: dto.accountNumber,
            accountName: dto.accountName,
            isDefault: dto.isDefault ?? false,
          },
        });
      } catch (err) {
        // unique constraint on (userId, accountNumber, bankName)
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException('Bank account already exists');
        }
        throw err;
      }
    });
  }

  /**
   * Edit a bank account. Setting `isDefault=true` un-flags the previous
   * default in the same transaction (same atomic-reassignment pattern as
   * create).
   *
   * @throws NotFoundException 404 — account doesn't exist OR belongs to a
   *   different user (same response — don't leak existence)
   */
  async update(
    userId: string,
    accountId: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccount> {
    await this.assertOwned(userId, accountId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.bankAccount.updateMany({
          where: { userId, isDefault: true, NOT: { id: accountId } },
          data: { isDefault: false },
        });
      }
      return tx.bankAccount.update({
        where: { id: accountId },
        data: {
          bankName: dto.bankName,
          accountNumber: dto.accountNumber,
          accountName: dto.accountName,
          isDefault: dto.isDefault,
        },
      });
    });
  }

  /**
   * Hard-delete a bank account. Refused with 409 if any payouts reference
   * it — payout history must never be orphaned. To "remove" an account
   * with payouts, the user has to wait for those payouts to settle (or use
   * an admin path that doesn't exist yet).
   *
   * @throws NotFoundException 404 — account doesn't exist OR not yours
   * @throws ConflictException 409 — payouts reference this account
   */
  async delete(userId: string, accountId: string): Promise<void> {
    await this.assertOwned(userId, accountId);

    try {
      await this.prisma.bankAccount.delete({ where: { id: accountId } });
    } catch (err) {
      // FK from payouts → bank_accounts blocks deletion if any payouts exist.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete bank account that has payouts',
        );
      }
      throw err;
    }
  }

  /**
   * Ownership guard — throws 404 if the account doesn't exist OR belongs
   * to a different user. Same 404 response either way: never leak the
   * existence of accounts owned by others (don't help attackers map IDs).
   */
  private async assertOwned(
    userId: string,
    accountId: string,
  ): Promise<BankAccount> {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    if (account.userId !== userId) {
      throw new NotFoundException('Bank account not found');
    }
    return account;
  }
}
