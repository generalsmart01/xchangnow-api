// src/modules/users/anonymization.service.ts

/**
 * AnonymizationService — implements the right-to-be-forgotten flow for
 * customer accounts. NEVER hard-deletes (transaction, payout, audit-log
 * FKs would orphan). Instead scrubs PII columns in-place and tombstones
 * the User row.
 *
 * Why a separate service vs putting it on UsersService:
 *   - Touches MANY tables atomically (User, Profile, BankAccount, sessions,
 *     three token tables, two log tables). The blast radius is too big to
 *     bury inside the regular UsersService surface where typos are
 *     dangerous.
 *   - Distinct security posture — every call writes a HIGH-severity
 *     security_log plus an admin_log + pii_access_log. Separate service
 *     keeps that audit trail unambiguous ("the AnonymizationService was
 *     called" is its own grep-friendly signal).
 *
 * What gets scrubbed (PII rulebook §7):
 *   - User:     email + emailNormalized → tombstone, passwordHash → random
 *               unusable, status → DEACTIVATED, isEmailVerified → false,
 *               lastLoginIp → null, deletedAt → now
 *   - Profile:  firstName/lastName replaced with sentinels, phone fields
 *               null'd, all KYC fields null'd
 *   - Bank accounts: accountNumber and accountName redacted in-place
 *               (rows kept so Payout history retains its FK)
 *   - Sessions: all active sessions revoked
 *   - Tokens:   all outstanding verification/reset/invite tokens deleted
 *
 * What is INTENTIONALLY preserved:
 *   - Transactions, Payouts, ExchangeRate updates (financial / legal record)
 *   - UserActivityLog, SecurityLog, LoginAttempt, AdminLog (audit trail)
 *   - DeviceRiskProfile (security analysis)
 *   - Sent invites (if the anonymized user invited others, the invitees
 *     can still accept — invitee's choice to join doesn't depend on
 *     inviter still being a customer)
 *
 * Idempotency: refuses with 409 if `deletedAt` is already set. Anonymizing
 * twice would scramble the audit trail (which `beforeState` is the real
 * one?), and there's no legitimate use case for re-running.
 */

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  RiskSeverity,
  SecurityEventType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PiiAccessLogService } from '../../common/pii/pii-access-log.service';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AnonymizationService {
  private readonly logger = new Logger(AnonymizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly piiAccessLog: PiiAccessLogService,
  ) {}

  /**
   * Atomically anonymize a user account. Caller MUST be admin and MUST
   * have confirmed the user's email matches the target.
   *
   * @returns Timestamp at which anonymization completed.
   * @throws NotFoundException 404 — target user doesn't exist
   * @throws ConflictException 409 — target is already anonymized
   * @throws ForbiddenException 403 — self-anonymization or SUPER_ADMIN target
   */
  async anonymizeUser(
    actorAdminId: string,
    targetUserId: string,
    confirmEmail: string,
    reason: string,
  ): Promise<{ anonymizedAt: Date }> {
    // Load current state — needed for the email confirmation check, the
    // SUPER_ADMIN guard, and the admin_logs beforeState snapshot.
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { profile: true },
    });
    if (!target) throw new NotFoundException('User not found');

    // Self-anonymization is refused — would lock the admin out of the
    // system mid-operation and corrupt the audit row (actor and target
    // would be the same anonymized id).
    if (actorAdminId === targetUserId) {
      throw new ForbiddenException('You cannot anonymize your own account');
    }

    // SUPER_ADMIN accounts are never anonymized via this endpoint —
    // bootstrap-only role. To remove a SUPER_ADMIN, edit env + redeploy
    // or use raw DB access with full audit trail.
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'SUPER_ADMIN accounts cannot be anonymized via this endpoint',
      );
    }

    // Already-anonymized check. We compare on deletedAt because the
    // email column would have been moved to a tombstone form already.
    if (target.deletedAt) {
      throw new ConflictException('User is already anonymized');
    }

    // Confirmation safety check — admin must re-type the target's email.
    // Compares against the normalized form for case-insensitive matching.
    const confirmNormalized = confirmEmail.trim().toLowerCase();
    if (target.emailNormalized !== confirmNormalized) {
      throw new ForbiddenException(
        'confirmEmail does not match the target user\'s email',
      );
    }

    const now = new Date();
    const tombstoneEmail = `deleted-user-${target.id}@xchangnow.local`;

    // Generate an unusable password hash — same pattern as staff.invite.
    // The high entropy of the random input means no realistic brute-force
    // attack can reverse it.
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    const unusableHash = await bcrypt.hash(
      randomBytes(48).toString('base64url'),
      rounds,
    );

    // beforeState captured for the admin_log row — what we're about to
    // destroy. Limited to the fields a future support investigation
    // would want ("the user's old email was X, name was Y").
    const beforeState = {
      email: target.email,
      firstName: target.profile?.firstName ?? null,
      lastName: target.profile?.lastName ?? null,
      role: target.role,
      status: target.status,
    };

    // Single $transaction — every write succeeds together or we roll back
    // entirely. Critical: a partial anonymization (e.g. Profile scrubbed
    // but User.email still real) would be worse than no anonymization.
    await this.prisma.$transaction([
      // 1. User row: tombstone email + kill credentials + mark deleted
      this.prisma.user.update({
        where: { id: targetUserId },
        data: {
          email: tombstoneEmail,
          emailNormalized: tombstoneEmail,
          passwordHash: unusableHash,
          status: UserStatus.DEACTIVATED,
          isEmailVerified: false,
          lastLoginIp: null,
          deletedAt: now,
        },
      }),

      // 2. Profile: scrub all human-identity fields + KYC encrypted blobs
      this.prisma.profile.update({
        where: { userId: targetUserId },
        data: {
          firstName: '[DELETED]',
          lastName: '[USER]',
          phoneNumber: null,
          phoneNumberNormalized: null,
          dateOfBirth: null,
          bvnEncrypted: null,
          bvnHash: null,
          ninEncrypted: null,
          ninHash: null,
        },
      }),

      // 3. Bank accounts: redact PII fields in-place. Rows preserved so
      //    Payout.bankAccountId FKs stay valid and historical payouts
      //    keep their reference.
      this.prisma.bankAccount.updateMany({
        where: { userId: targetUserId },
        data: {
          accountNumber: 'DELETED',
          accountName: '[DELETED]',
        },
      }),

      // 4. Revoke every active session for this user
      this.prisma.userSession.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: now },
      }),

      // 5. Delete outstanding tokens — these are short-lived and pointless
      //    on an anonymized account. Unlike sessions, we hard-delete
      //    rather than mark-used: the tokens carried no audit value of
      //    their own.
      this.prisma.emailVerificationToken.deleteMany({
        where: { userId: targetUserId },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: targetUserId },
      }),
      this.prisma.inviteToken.deleteMany({
        where: { userId: targetUserId },
      }),

      // 6. Security log — HIGH severity. Anonymization is one of the most
      //    consequential admin actions; surface it loudly in any security
      //    review.
      this.prisma.securityLog.create({
        data: {
          userId: targetUserId,
          eventType: SecurityEventType.ADMIN_OVERRIDE,
          severity: RiskSeverity.HIGH,
          metadata: {
            action: 'USER_ANONYMIZED',
            by: actorAdminId,
            reason,
          } as never,
        },
      }),

      // 7. Admin log — records the before/after for compliance review
      this.prisma.adminLog.create({
        data: {
          adminId: actorAdminId,
          action: 'USER_ANONYMIZED',
          entityType: 'USER',
          entityId: targetUserId,
          beforeState: beforeState as never,
          afterState: {
            email: tombstoneEmail,
            firstName: '[DELETED]',
            lastName: '[USER]',
            status: UserStatus.DEACTIVATED,
            deletedAt: now,
          } as never,
        },
      }),
    ]);

    // 8. PiiAccessLog — the compliance "who touched whose PII" trail.
    //    Outside the $transaction because PiiAccessLogService.log
    //    swallows errors (we never want audit logging to break the
    //    user-visible operation).
    await this.piiAccessLog.log({
      actorUserId: actorAdminId,
      targetUserId,
      resourceType: 'PROFILE',
      resourceId: targetUserId,
      action: 'ANONYMIZE',
      reason,
    });

    this.logger.warn(
      `User anonymized userId=${targetUserId} by adminId=${actorAdminId} reason="${reason}"`,
    );

    return { anonymizedAt: now };
  }
}
