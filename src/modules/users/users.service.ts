import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankAccount, Prisma, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AdminUpdateUserStatusDto } from './dto/admin-update-user-status.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { UpdateUserDto } from './dto/update-user.dto';

export type SafeUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------ self-service ------------------------------

  async findById(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserDto,
  ): Promise<SafeUser> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
      },
    });
    return this.sanitize(updated);
  }

  // ------------------------------ bank accounts ------------------------------

  listBankAccounts(userId: string): Promise<BankAccount[]> {
    return this.prisma.bankAccount.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createBankAccount(
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

  async updateBankAccount(
    userId: string,
    accountId: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccount> {
    // Ownership guard — findFirstOrThrow scopes by userId.
    await this.findOwnedBankAccount(userId, accountId);

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

  async deleteBankAccount(userId: string, accountId: string): Promise<void> {
    await this.findOwnedBankAccount(userId, accountId);

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

  private async findOwnedBankAccount(
    userId: string,
    accountId: string,
  ): Promise<BankAccount> {
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    if (account.userId !== userId) {
      // 404 not 403 — don't leak existence of accounts owned by others
      throw new NotFoundException('Bank account not found');
    }
    return account;
  }

  // --------------------------------- admin ---------------------------------

  async listUsers(query: ListUsersQueryDto): Promise<{
    users: SafeUser[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { fullName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users.map((u) => this.sanitize(u)),
      total,
      page,
      pageSize,
    };
  }

  async findByIdAsAdmin(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  async updateUserStatus(
    adminId: string,
    targetUserId: string,
    dto: AdminUpdateUserStatusDto,
  ): Promise<SafeUser> {
    if (adminId === targetUserId && dto.status !== UserStatus.ACTIVE) {
      // Don't let an admin lock themselves out
      throw new ForbiddenException('Admins cannot deactivate themselves');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: dto.status },
    });

    // Audit trail — admin actions go in admin_logs (not user_activity_logs).
    // adminId here is a regular user with ADMIN role; admin_logs.adminId is
    // a foreign key to admin_users. Until we split admins into admin_users,
    // we skip the FK write here and rely on user_activity_logs for the trace.
    await this.prisma.userActivityLog.create({
      data: {
        userId: targetUserId,
        action: 'STATUS_CHANGED',
        metadata: {
          by: adminId,
          newStatus: dto.status,
          reason: dto.reason ?? null,
        } as never,
      },
    });

    return this.sanitize(updated);
  }

  // ---------------------------------- util ----------------------------------

  private sanitize(user: User): SafeUser {
    const { passwordHash: _omit, ...rest } = user;
    return rest;
  }
}
