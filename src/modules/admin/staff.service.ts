// src/modules/admin/staff.service.ts

/**
 * StaffService — manages staff (ADMIN / OPS / CUSTOMER_SERVICE) accounts.
 *
 * Public surface:
 *   - invite(inviter, dto)      Create a staff user + send invite email.
 *                               Reuses AuthService.issueInviteToken so the
 *                               accept-invite flow (in AuthController) Just
 *                               Works without any staff-specific endpoints.
 *   - list(actor, query)        Paginated non-USER accounts; admin filterable.
 *   - updateRole(actor, ...)    Move between ADMIN/OPS/CUSTOMER_SERVICE.
 *                               REJECTS any path to SUPER_ADMIN (only seed
 *                               creates SUPER_ADMINs).
 *
 * Security invariants:
 *   - SUPER_ADMIN role cannot be assigned through ANY endpoint here. DTO
 *     @IsIn rejects it; service re-checks (defence in depth).
 *   - SUPER_ADMINs are immutable through these endpoints — admin can't
 *     demote or promote them. To remove a SUPER_ADMIN, use the user-status
 *     update endpoint to DEACTIVATE them (status, not role).
 *   - Self-protection: an admin cannot change their own role.
 *   - Every write (invite, role change) emits TWO audit rows:
 *       * admin_logs        (STAFF_INVITED / STAFF_ROLE_CHANGED)
 *       * pii_access_logs   (PROFILE/STAFF CREATE/UPDATE — PII compliance)
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PiiAccessLogService } from '../../common/pii/pii-access-log.service';
import { PrismaService } from '../../database/prisma.service';
import { generateReferralCode } from '../../common/utils/generate-referral-code';
import {
  flattenUserMasked,
  SafeUserMasked,
} from '../../common/utils/mask-pii';
import { normalizeEmail } from '../../common/utils/normalize-email';
import { normalizePhoneE164 } from '../../common/utils/normalize-phone';
import { EmailService } from '../../integrations/email/email.service';
import { AuthService } from '../auth/auth.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffRoleDto } from './dto/update-staff-role.dto';

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
    private readonly piiAccessLog: PiiAccessLogService,
  ) {}

  /**
   * Create a staff member with no real password and dispatch an invite email.
   *
   * The user row is created with a random unusable passwordHash so the column's
   * NOT NULL constraint is satisfied; the real password is set when the
   * invitee posts to /auth/accept-invite. Until then, status stays
   * PENDING_VERIFICATION and the user cannot log in (the strict-gate login
   * check requires status=ACTIVE).
   */
  async invite(
    inviter: { id: string; firstName: string; lastName: string },
    dto: CreateStaffDto,
  ): Promise<{ user: SafeUserMasked; inviteToken?: string }> {
    const rawEmail = dto.email.trim();
    const emailNormalized = normalizeEmail(dto.email);
    if (!emailNormalized) {
      // Defensive — @IsEmail should have already rejected garbage input.
      throw new ConflictException('Email is not valid');
    }

    // Hash an unusable random password — bcrypt happily hashes anything, and
    // the result is opaque to brute force given the entropy. The invitee
    // overwrites this when they accept.
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    const placeholderHash = await bcrypt.hash(
      randomBytes(48).toString('base64url'),
      rounds,
    );

    // Same dual-write pattern as register: store raw input for display,
    // normalized E.164 for uniqueness. Validator already confirmed the input
    // is parseable, so normalize returning null is unexpected — tolerated.
    const phoneNumberNormalized = normalizePhoneE164(dto.phoneNumber);

    let user: Prisma.UserGetPayload<{ include: { profile: true } }>;
    try {
      user = await this.prisma.user.create({
        data: {
          email: rawEmail,
          emailNormalized,
          passwordHash: placeholderHash,
          role: dto.role,
          status: UserStatus.PENDING_VERIFICATION,
          isEmailVerified: false,
          // Staff get referral codes too — same as customers. They can
          // technically refer signups, though staff-as-referrer isn't a
          // documented product feature today. Codes are required schema-
          // wise so we mint one regardless.
          referralCode: generateReferralCode(),
          profile: {
            create: {
              firstName: dto.firstName,
              lastName: dto.lastName,
              phoneNumber: dto.phoneNumber,
              phoneNumberNormalized,
            },
          },
        },
        include: { profile: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta?.target as string[] | undefined)?.[0];
        // Unique constraint is on the NORMALIZED column now.
        if (target === 'phone_number_normalized') {
          throw new ConflictException('Phone number already registered');
        }
        if (target === 'email_normalized') {
          throw new ConflictException('Email already registered');
        }
        if (target === 'referral_code') {
          throw new ConflictException(
            'Generated referral code collided. Please retry.',
          );
        }
        throw new ConflictException('Account already exists');
      }
      throw err;
    }

    const { rawToken } = await this.auth.issueInviteToken(
      user.id,
      inviter.id,
      dto.role,
    );

    await this.email.sendInviteEmail(user.email, rawToken, {
      inviterName: `${inviter.firstName} ${inviter.lastName}`,
      role: dto.role,
    });

    // Audit. AdminLog uses entityType/entityId + before/after JSON; for a
    // creation, beforeState is null and afterState captures the new shape.
    await this.prisma.adminLog.create({
      data: {
        adminId: inviter.id,
        action: 'STAFF_INVITED',
        entityType: 'USER',
        entityId: user.id,
        afterState: {
          email: user.email,
          role: dto.role,
          status: user.status,
        } as never,
      },
    });

    this.logger.warn(
      `Staff invited userId=${user.id} email=${user.email} role=${dto.role} by inviterId=${inviter.id}`,
    );

    // PII access log — creating a Profile is a write of PII. This row pairs
    // with the admin_logs.STAFF_INVITED above (general admin action) so the
    // compliance view ("who created customer PII?") is a single-table query.
    await this.piiAccessLog.log({
      actorUserId: inviter.id,
      targetUserId: user.id,
      resourceType: 'PROFILE',
      resourceId: user.id,
      action: 'CREATE',
      metadata: { role: dto.role, email: user.email },
    });

    // Dev-mode affordance — same pattern as /auth/register
    const isDev = process.env.NODE_ENV !== 'production';
    return {
      user: flattenUserMasked(user),
      ...(isDev ? { inviteToken: rawToken } : {}),
    };
  }

  /**
   * Paginated list of all non-USER accounts (the "staff" view). Filters by
   * role and status; returns paginated shape matching the rest of the API.
   */
  async list(
    actorAdminId: string,
    query: ListStaffQueryDto,
  ): Promise<{
    staff: SafeUserMasked[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.UserWhereInput = {
      role: query.role ? { equals: query.role } : { not: UserRole.USER },
      ...(query.status ? { status: query.status } : {}),
      deletedAt: null,
    };

    const [staff, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    // One audit row per list call (not per result). Filters captured in metadata.
    await this.piiAccessLog.log({
      actorUserId: actorAdminId,
      targetUserId: actorAdminId, // see comment in users.service.listUsers
      resourceType: 'STAFF',
      action: 'LIST',
      metadata: {
        page,
        pageSize,
        returned: staff.length,
        total,
        filters: {
          role: query.role ?? null,
          status: query.status ?? null,
        },
      },
    });

    return {
      staff: staff.map((u) => flattenUserMasked(u)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Change a staff member's role. Restrictions enforced here:
   *   - Can never set role=SUPER_ADMIN (only the seed script can)
   *   - Can never change role of a SUPER_ADMIN target (locks the role)
   *   - Can never change own role (self-protection)
   *   - Can never set role=USER (would demote staff to a customer, which is
   *     not a meaningful operation — use status=DEACTIVATED instead)
   *
   * The DTO already rejects SUPER_ADMIN/USER via @IsIn but we re-check here
   * because the service is the source of truth (defence in depth).
   */
  async updateRole(
    superAdminId: string,
    targetUserId: string,
    dto: UpdateStaffRoleDto,
  ): Promise<SafeUserMasked> {
    if (superAdminId === targetUserId) {
      throw new ForbiddenException('You cannot change your own role');
    }

    if (
      dto.role === UserRole.SUPER_ADMIN ||
      (dto.role as UserRole) === UserRole.USER
    ) {
      // Defence in depth — DTO @IsIn already rejects these.
      throw new BadRequestException(
        'Cannot set role to SUPER_ADMIN or USER via this endpoint',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target || target.deletedAt) {
      throw new NotFoundException('Staff member not found');
    }

    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'SUPER_ADMIN role is locked — cannot be changed via this endpoint',
      );
    }

    if (target.role === UserRole.USER) {
      throw new BadRequestException(
        'Target is not a staff member (role=USER). Use staff invite to promote.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: dto.role },
      include: { profile: true },
    });

    await this.prisma.adminLog.create({
      data: {
        adminId: superAdminId,
        action: 'STAFF_ROLE_CHANGED',
        entityType: 'USER',
        entityId: targetUserId,
        beforeState: { role: target.role } as never,
        afterState: {
          role: dto.role,
          reason: dto.reason ?? null,
        } as never,
      },
    });

    this.logger.warn(
      `Staff role changed userId=${targetUserId} ${target.role} → ${dto.role} by superAdminId=${superAdminId}`,
    );

    // Role change is a privileged write on the user record. Log alongside the
    // admin_logs entry above so the PII-access view shows it without a join.
    await this.piiAccessLog.log({
      actorUserId: superAdminId,
      targetUserId,
      resourceType: 'STAFF',
      resourceId: targetUserId,
      action: 'UPDATE',
      reason: dto.reason,
      metadata: { fromRole: target.role, toRole: dto.role },
    });

    return flattenUserMasked(updated);
  }

}
