// src/modules/users/users.service.ts

/**
 * Domain service for User + Profile + BankAccount.
 *
 * Public surface, grouped by concern:
 *
 *   Self-service (operates on the authenticated caller):
 *     - findById              fetch own profile (User + Profile flattened)
 *     - updateProfile         edit name + phone (raw + normalized written)
 *     - listBankAccounts      list own bank accounts, default first
 *     - createBankAccount     add bank account (atomic default re-assignment)
 *     - updateBankAccount     edit; setting isDefault=true re-assigns atomically
 *     - deleteBankAccount     hard delete; refuses if payouts reference it
 *
 *   Admin (gated by RolesGuard at the controller; service trusts the caller):
 *     - listUsers             paginated/filterable list (writes PiiAccessLog.LIST)
 *     - findByIdAsAdmin       fetch arbitrary user (writes PiiAccessLog.READ)
 *     - updateUserStatus      change ACTIVE/SUSPENDED/etc; refuses self-deactivation
 *                            (writes PiiAccessLog.UPDATE + user_activity_logs)
 *
 * Cross-cutting:
 *   - Phone updates normalize via libphonenumber-js (NG-only) and write both
 *     `phoneNumber` (raw display) and `phoneNumberNormalized` (canonical
 *     E.164) — the unique constraint lives on the normalized column.
 *   - Every admin-side read or write of someone ELSE's PII writes a
 *     PiiAccessLog row. Self-reads are NOT logged (the user fetching their
 *     own profile is the normal product flow, not a compliance event).
 */

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PiiAccessLogService } from '../../common/pii/pii-access-log.service';
import { PrismaService } from '../../database/prisma.service';
import { flattenUser, SafeUser } from '../../common/utils/flatten-user';
import {
  flattenUserMasked,
  SafeUserMasked,
} from '../../common/utils/mask-pii';
import { normalizePhoneE164 } from '../../common/utils/normalize-phone';
import { AdminUpdateUserStatusDto } from './dto/admin-update-user-status.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';

// Re-export for legacy imports that still reference users.service's SafeUser
export type { SafeUser };

/**
 * UsersService — the authoritative read/write surface for User + Profile.
 * Owns the dual-write of phone (raw + normalized) and the audit obligations
 * for admin reads of customer PII.
 *
 * NOT this service's concern:
 *   - Authentication (login, register, password) — AuthService
 *   - Bank accounts (financial PII tier) — BankAccountsService
 *   - Staff invitation flow — StaffService (under admin module)
 *   - Transactions, payouts, anything money-moving
 *
 * Consumers (besides the obvious UsersController):
 *   - TransactionsService.createSell — looks up the user's default bank
 *     account before creating a SELL transaction (direct Prisma query, not
 *     through this service)
 *   - PayoutsService — joins to BankAccount via the transaction
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly piiAccessLog: PiiAccessLogService,
  ) {}

  // ------------------------------ self-service ------------------------------

  async findById(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  /**
   * Edit the caller's profile fields. All fields optional — only the keys
   * actually present in the DTO are written; `undefined` means "leave alone"
   * per Prisma's update semantics.
   *
   * Phone-specific behavior:
   *   - If `phoneNumber` is provided as a non-empty string → write both raw
   *     (display) and normalized (E.164, unique-constrained)
   *   - If `phoneNumber` is the empty string → null both fields (user is
   *     clearing their phone)
   *   - If `phoneNumber` is omitted entirely → leave both fields untouched
   *
   * @throws ConflictException 409 — phone collides with another user's
   *   normalized form (different format, same number)
   */
  async updateProfile(
    userId: string,
    dto: UpdateUserDto,
  ): Promise<SafeUser> {
    // Build the Profile update payload. We only set phoneNumberNormalized
    // when phoneNumber was actually provided in the DTO — undefined means
    // "don't touch" (Prisma rule), null/string means "set to this value".
    // If the user clears their phone (sends ""), both fields should be null.
    const data: Prisma.ProfileUpdateInput = {
      firstName: dto.firstName,
      lastName: dto.lastName,
    };
    if (dto.phoneNumber !== undefined) {
      data.phoneNumber = dto.phoneNumber || null;
      data.phoneNumberNormalized = normalizePhoneE164(dto.phoneNumber);
    }

    // Upsert (not update) so users that predate the Profile migration can
    // still PATCH their profile — we auto-create the missing Profile row.
    // The `create` branch needs explicit defaults for required fields when
    // the DTO didn't supply them (firstName/lastName are required on
    // Profile schema-side).
    try {
      await this.prisma.profile.upsert({
        where: { userId },
        update: data,
        create: {
          userId,
          firstName: dto.firstName ?? '',
          lastName: dto.lastName ?? '',
          phoneNumber: dto.phoneNumber || null,
          phoneNumberNormalized: dto.phoneNumber
            ? normalizePhoneE164(dto.phoneNumber)
            : null,
        },
      });
    } catch (err) {
      // Phone uniqueness is enforced on Profile now — catch the same way
      // register does so updates don't 500 on a duplicate phone.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | undefined)?.[0];
        if (target === 'phone_number_normalized') {
          throw new ConflictException('Phone number already registered');
        }
        throw new ConflictException('Profile field conflict');
      }
      throw err;
    }

    // Re-read the user (with profile) so the response carries the canonical
    // fresh shape, including updatedAt timestamps.
    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });
    return this.sanitize(updated);
  }

  // --------------------------------- admin ---------------------------------

  /**
   * Admin-only paginated user list. Soft-deleted users (deletedAt set) are
   * excluded. Search matches across email + firstName + lastName
   * (case-insensitive substring).
   *
   * Returns MASKED shape — `phoneNumberMasked` instead of `phoneNumber`.
   * Admins listing users have no operational need for full phone numbers;
   * masking is the safer default and matches the PII rulebook §29.
   *
   * Audit: emits ONE PiiAccessLog row per call (not per result) with the
   * filters + result count in metadata. A row-per-result list would balloon
   * the audit table on large pages.
   */
  async listUsers(
    actorAdminId: string,
    query: ListUsersQueryDto,
  ): Promise<{
    users: SafeUserMasked[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    // firstName/lastName are now on Profile, so the search joins through
    // the relation. Email stays on User. Prisma generates one query with
    // the appropriate JOIN.
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { profile: { firstName: { contains: query.search, mode: 'insensitive' } } },
              { profile: { lastName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    // Audit the list access. One row per call, with metadata capturing the
    // result size + filters. We DON'T emit a row per user returned — that
    // would balloon the table on large pages.
    await this.piiAccessLog.log({
      actorUserId: actorAdminId,
      // For LIST events, the "target" is the actor themselves — list ops don't
      // single out a specific user but they DO expose PII for many. Using actor
      // as target keeps the FK constraint satisfied; queries filter on
      // resourceType+action=LIST to find these.
      targetUserId: actorAdminId,
      resourceType: 'PROFILE',
      action: 'LIST',
      metadata: {
        page,
        pageSize,
        returned: users.length,
        total,
        filters: {
          status: query.status ?? null,
          search: query.search ?? null,
        },
      },
    });

    return {
      users: users.map((u) => flattenUserMasked(u)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Admin reads a specific user's full profile. Includes soft-deleted users
   * (admins need to see deactivated accounts for support / compliance).
   *
   * Returns MASKED shape — `phoneNumberMasked` instead of `phoneNumber`.
   * If an admin legitimately needs the full phone (support call, KYC
   * verification, etc.) that should go through a separate explicit
   * endpoint that writes a higher-severity audit row — not piggy-back on
   * the default user-detail view.
   *
   * Audit: writes a PiiAccessLog (PROFILE READ) row tying the calling admin
   * to the target user. Required by the PII rulebook §26 — "who viewed
   * this customer's data?" must be answerable with a single SELECT.
   */
  async findByIdAsAdmin(
    actorAdminId: string,
    userId: string,
  ): Promise<SafeUserMasked> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Audit every admin read of a customer's profile.
    await this.piiAccessLog.log({
      actorUserId: actorAdminId,
      targetUserId: userId,
      resourceType: 'PROFILE',
      resourceId: userId,
      action: 'READ',
    });

    return flattenUserMasked(user);
  }

  /**
   * Admin transitions a user between ACTIVE / SUSPENDED /
   * PENDING_VERIFICATION / DEACTIVATED.
   *
   * Self-protection rules enforced here:
   *   - Admins cannot move themselves to anything OTHER than ACTIVE
   *     (prevents accidental self-lockout — only another admin can
   *     suspend you)
   *
   * Audit trail written in three places for compliance defense-in-depth:
   *   - user_activity_logs  STATUS_CHANGED with {by, newStatus, reason}
   *   - pii_access_logs     USER UPDATE with reason + newStatus metadata
   *   - logger.warn         terminal log for live observation
   *
   * @throws ForbiddenException 403 — admin tried to demote themselves
   */
  async updateUserStatus(
    adminId: string,
    targetUserId: string,
    dto: AdminUpdateUserStatusDto,
  ): Promise<SafeUserMasked> {
    if (adminId === targetUserId && dto.status !== UserStatus.ACTIVE) {
      // Don't let an admin lock themselves out
      throw new ForbiddenException('Admins cannot deactivate themselves');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: dto.status },
      include: { profile: true },
    });

    this.logger.warn(
      `User status changed userId=${targetUserId} → ${dto.status} by adminId=${adminId}` +
        (dto.reason ? ` reason="${dto.reason}"` : ''),
    );

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

    // Status changes are a privileged write on a user account — separately
    // logged in pii_access_logs so the compliance view of "who touched this
    // customer" doesn't require joining across log tables.
    await this.piiAccessLog.log({
      actorUserId: adminId,
      targetUserId,
      resourceType: 'USER',
      resourceId: targetUserId,
      action: 'UPDATE',
      reason: dto.reason,
      metadata: { newStatus: dto.status },
    });

    return flattenUserMasked(updated);
  }

  // ---------------------------------- util ----------------------------------

  /** Strip passwordHash + flatten the Profile relation. */
  private sanitize(user: Parameters<typeof flattenUser>[0]): SafeUser {
    return flattenUser(user);
  }
}
