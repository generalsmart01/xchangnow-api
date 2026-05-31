// src/modules/kyc/kyc.service.ts

/**
 * KycService — owns the manual KYC verification flow.
 *
 * The flow:
 *   1. User submits BVN or NIN (or both) plus a selfie URL via POST /kyc/me.
 *      Submission encrypts BVN/NIN with kyc-encryption + writes the HMAC
 *      hash for uniqueness; sets kycStatus = PENDING.
 *   2. Admin sees the queue at GET /kyc?status=PENDING.
 *   3. Admin opens GET /kyc/:userId — service decrypts BVN/NIN to plaintext
 *      ONLY for this read, logs a PiiAccessLog (KYC_DOCUMENT READ).
 *   4. Admin decides → POST /kyc/:userId/approve OR /kyc/:userId/reject.
 *
 * Why a service-level uniqueness check (instead of relying on the DB):
 *   The bvn_hash / nin_hash columns ARE @unique, so a duplicate submission
 *   from a DIFFERENT user would already fail at the DB layer (Prisma P2002).
 *   But the error would be cryptic ("unique constraint failed"). We do an
 *   explicit pre-check so we can return a meaningful 409 message + know
 *   what to suggest to the user ("this BVN is already in use; if it's
 *   really yours, contact support").
 *
 * What this service does NOT do:
 *   - No external verification (NIBSS / NIMC / Smile / Prembly). That's the
 *     "with provider" path the user deferred. Admin eyeballs are the gate
 *     for now.
 *   - No face match / liveness — admin reviews the selfie URL manually.
 *   - No tier system — flat binary APPROVED / not-APPROVED. The future tier
 *     system would slot in here.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  KycStatus,
  Prisma,
  RiskSeverity,
  SecurityEventType,
} from '@prisma/client';
import { encryptKyc, decryptKyc } from '../../common/crypto/kyc-encryption';
import { hashKyc } from '../../common/crypto/kyc-hash';
import { PiiAccessLogService } from '../../common/pii/pii-access-log.service';
import { PrismaService } from '../../database/prisma.service';
import { ListKycQueryDto } from './dto/list-kyc-query.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';

/** What a user sees about their own KYC — no plaintext BVN/NIN. */
export interface KycSelfView {
  status: KycStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  selfieUrl: string | null;
  hasBvn: boolean;
  hasNin: boolean;
}

/** What an admin sees in the queue — no decryption, lightweight summary. */
export interface KycListItem {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: KycStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  hasBvn: boolean;
  hasNin: boolean;
}

/** What an admin sees when reviewing ONE submission — decrypts BVN/NIN. */
export interface KycAdminFullView extends KycListItem {
  bvn: string | null; // decrypted
  nin: string | null; // decrypted
  selfieUrl: string | null;
  rejectionReason: string | null;
  reviewedById: string | null;
}

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly piiAccessLog: PiiAccessLogService,
  ) {}

  // ============================ user-facing ============================

  /**
   * User submits KYC. At least one of bvn/nin must be present. Submission:
   *   - Encrypts the provided identifier(s), hashes for uniqueness
   *   - Stores selfie URL
   *   - Sets kycStatus = PENDING, stamps kycSubmittedAt
   *   - Clears any prior rejection reason (resubmission flow)
   *   - PiiAccessLog: KYC_DOCUMENT CREATE
   *
   * If the user already has APPROVED status, refuses with 409 — re-verifying
   * isn't a meaningful operation, and we don't want admins approving an
   * already-approved user as if it were fresh.
   */
  async submit(userId: string, dto: SubmitKycDto): Promise<KycSelfView> {
    if (!dto.bvn && !dto.nin) {
      throw new BadRequestException('At least one of bvn or nin is required');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId },
    });
    if (!profile) {
      // Profile should always exist (created with user). Treat as data
      // integrity error rather than user-visible.
      throw new NotFoundException('Profile not found');
    }

    if (profile.kycStatus === KycStatus.APPROVED) {
      throw new ConflictException('KYC is already approved for this account');
    }

    // Compute hashes BEFORE the transaction so we can do an explicit
    // uniqueness check with a meaningful 409 message. Belt + suspenders:
    // the @unique on bvn_hash / nin_hash is the source of truth.
    const bvnHash = dto.bvn ? hashKyc(dto.bvn) : null;
    const ninHash = dto.nin ? hashKyc(dto.nin) : null;

    if (bvnHash) {
      const existing = await this.prisma.profile.findFirst({
        where: { bvnHash, NOT: { userId } },
      });
      if (existing) {
        throw new ConflictException(
          'This BVN is already registered to another account. ' +
            'If you believe this is a mistake, contact support.',
        );
      }
    }
    if (ninHash) {
      const existing = await this.prisma.profile.findFirst({
        where: { ninHash, NOT: { userId } },
      });
      if (existing) {
        throw new ConflictException(
          'This NIN is already registered to another account. ' +
            'If you believe this is a mistake, contact support.',
        );
      }
    }

    // Encrypt at the last moment — minimize the window the plaintext lives
    // in memory. (Node strings are immutable; we can't really "wipe" them,
    // but at least we don't hold onto them across awaits.)
    const bvnEncrypted = dto.bvn ? encryptKyc(dto.bvn) : null;
    const ninEncrypted = dto.nin ? encryptKyc(dto.nin) : null;

    const updated = await this.prisma.profile.update({
      where: { userId },
      data: {
        // Only overwrite the fields the user supplied. If they only sent a
        // BVN this time but already had a NIN on file, keep the NIN.
        ...(bvnEncrypted ? { bvnEncrypted, bvnHash } : {}),
        ...(ninEncrypted ? { ninEncrypted, ninHash } : {}),
        selfieUrl: dto.selfieUrl,
        kycStatus: KycStatus.PENDING,
        kycSubmittedAt: new Date(),
        // Clear the previous reviewer info — fresh submission, fresh review.
        kycReviewedAt: null,
        kycReviewedById: null,
        kycRejectionReason: null,
      },
    });

    await this.piiAccessLog.log({
      actorUserId: userId,
      targetUserId: userId,
      resourceType: 'KYC_DOCUMENT',
      action: 'CREATE',
      metadata: { hasBvn: !!bvnEncrypted, hasNin: !!ninEncrypted },
    });

    this.logger.log(`KYC submitted userId=${userId} (status → PENDING)`);

    return this.toSelfView(updated);
  }

  /**
   * User views their own KYC status. Does NOT decrypt BVN/NIN — the user
   * already knows their numbers; no point exposing them in a response that
   * could be screen-shared.
   */
  async getOwn(userId: string): Promise<KycSelfView> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return this.toSelfView(profile);
  }

  // ============================ admin-facing ============================

  /**
   * Admin paginated KYC queue. Default sort: oldest submission first (so
   * admins clear the queue fairly). Filterable by status (PENDING is the
   * common admin filter).
   *
   * Returns a lightweight list-item shape — no decryption (admin only sees
   * BVN/NIN when they click into a specific submission).
   */
  async listForAdmin(
    actorAdminId: string,
    query: ListKycQueryDto,
  ): Promise<{
    submissions: KycListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ProfileWhereInput = {
      ...(query.status ? { kycStatus: query.status } : {}),
      // Exclude soft-deleted users from the queue — anonymized accounts
      // shouldn't appear for review.
      user: { deletedAt: null },
    };

    const [rows, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        include: {
          user: { select: { email: true } },
        },
        orderBy: { kycSubmittedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.profile.count({ where }),
    ]);

    // List access is logged once per call (matches pattern in users.listUsers).
    await this.piiAccessLog.log({
      actorUserId: actorAdminId,
      targetUserId: actorAdminId,
      resourceType: 'KYC_DOCUMENT',
      action: 'LIST',
      metadata: { page, pageSize, returned: rows.length, total },
    });

    return {
      submissions: rows.map((p) => ({
        userId: p.userId,
        email: p.user.email,
        firstName: p.firstName,
        lastName: p.lastName,
        status: p.kycStatus,
        submittedAt: p.kycSubmittedAt,
        reviewedAt: p.kycReviewedAt,
        hasBvn: !!p.bvnEncrypted,
        hasNin: !!p.ninEncrypted,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Admin opens one submission for review. DECRYPTS bvn/nin to plaintext
   * because the admin needs to check them against the selfie. The
   * decryption is the most audit-worthy single operation in the system —
   * writes PiiAccessLog (KYC_DOCUMENT READ).
   *
   * If both decryption fails (no env key, bad ciphertext) the call surfaces
   * the values as null — better to let the admin still see the rest of the
   * record (selfie URL etc.) than 500 the whole review screen.
   */
  async findForAdmin(
    actorAdminId: string,
    targetUserId: string,
  ): Promise<KycAdminFullView> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: targetUserId },
      include: {
        user: { select: { email: true } },
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    // Decrypt defensively — if the env keys are misconfigured we don't want
    // the admin staring at a 500 on the review screen.
    const bvn = this.tryDecrypt(profile.bvnEncrypted, targetUserId, 'BVN');
    const nin = this.tryDecrypt(profile.ninEncrypted, targetUserId, 'NIN');

    await this.piiAccessLog.log({
      actorUserId: actorAdminId,
      targetUserId,
      resourceType: 'KYC_DOCUMENT',
      resourceId: targetUserId,
      action: 'READ',
      reason: 'Admin KYC review',
      metadata: { decryptedBvn: !!bvn, decryptedNin: !!nin },
    });

    return {
      userId: profile.userId,
      email: profile.user.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      status: profile.kycStatus,
      submittedAt: profile.kycSubmittedAt,
      reviewedAt: profile.kycReviewedAt,
      reviewedById: profile.kycReviewedById,
      hasBvn: !!profile.bvnEncrypted,
      hasNin: !!profile.ninEncrypted,
      bvn,
      nin,
      selfieUrl: profile.selfieUrl,
      rejectionReason: profile.kycRejectionReason,
    };
  }

  /**
   * Admin approves the KYC submission. Atomic with an admin_log row.
   *
   * Refuses if not currently PENDING — approving an already-APPROVED user
   * is a no-op that would muddy the audit; rejecting and then reverting is
   * a different workflow we don't support here.
   */
  async approve(actorAdminId: string, targetUserId: string): Promise<KycSelfView> {
    if (actorAdminId === targetUserId) {
      throw new ForbiddenException('You cannot approve your own KYC');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId: targetUserId },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    if (profile.kycStatus !== KycStatus.PENDING) {
      throw new BadRequestException(
        `Cannot approve KYC in status ${profile.kycStatus}; expected PENDING`,
      );
    }

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.profile.update({
        where: { userId: targetUserId },
        data: {
          kycStatus: KycStatus.APPROVED,
          kycReviewedAt: now,
          kycReviewedById: actorAdminId,
          kycRejectionReason: null,
        },
      }),
      this.prisma.adminLog.create({
        data: {
          adminId: actorAdminId,
          action: 'KYC_APPROVED',
          entityType: 'PROFILE',
          entityId: targetUserId,
          beforeState: { kycStatus: profile.kycStatus } as never,
          afterState: { kycStatus: KycStatus.APPROVED } as never,
        },
      }),
      this.prisma.securityLog.create({
        data: {
          userId: targetUserId,
          eventType: SecurityEventType.ADMIN_OVERRIDE,
          severity: RiskSeverity.MEDIUM,
          metadata: { action: 'KYC_APPROVED', by: actorAdminId } as never,
        },
      }),
    ]);

    await this.piiAccessLog.log({
      actorUserId: actorAdminId,
      targetUserId,
      resourceType: 'KYC_DOCUMENT',
      resourceId: targetUserId,
      action: 'UPDATE',
      metadata: { kycStatus: KycStatus.APPROVED },
    });

    this.logger.log(
      `KYC APPROVED userId=${targetUserId} by adminId=${actorAdminId}`,
    );

    return this.toSelfView(updated);
  }

  /**
   * Admin rejects with a mandatory reason. The user can then resubmit
   * (which flips status back to PENDING).
   */
  async reject(
    actorAdminId: string,
    targetUserId: string,
    reason: string,
  ): Promise<KycSelfView> {
    if (actorAdminId === targetUserId) {
      throw new ForbiddenException('You cannot reject your own KYC');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId: targetUserId },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    if (profile.kycStatus !== KycStatus.PENDING) {
      throw new BadRequestException(
        `Cannot reject KYC in status ${profile.kycStatus}; expected PENDING`,
      );
    }

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.profile.update({
        where: { userId: targetUserId },
        data: {
          kycStatus: KycStatus.REJECTED,
          kycReviewedAt: now,
          kycReviewedById: actorAdminId,
          kycRejectionReason: reason,
        },
      }),
      this.prisma.adminLog.create({
        data: {
          adminId: actorAdminId,
          action: 'KYC_REJECTED',
          entityType: 'PROFILE',
          entityId: targetUserId,
          beforeState: { kycStatus: profile.kycStatus } as never,
          afterState: { kycStatus: KycStatus.REJECTED, reason } as never,
        },
      }),
    ]);

    await this.piiAccessLog.log({
      actorUserId: actorAdminId,
      targetUserId,
      resourceType: 'KYC_DOCUMENT',
      resourceId: targetUserId,
      action: 'UPDATE',
      reason,
      metadata: { kycStatus: KycStatus.REJECTED },
    });

    this.logger.warn(
      `KYC REJECTED userId=${targetUserId} by adminId=${actorAdminId} reason="${reason}"`,
    );

    return this.toSelfView(updated);
  }

  // ============================ internals ============================

  private toSelfView(profile: {
    kycStatus: KycStatus;
    kycSubmittedAt: Date | null;
    kycReviewedAt: Date | null;
    kycRejectionReason: string | null;
    selfieUrl: string | null;
    bvnEncrypted: string | null;
    ninEncrypted: string | null;
  }): KycSelfView {
    return {
      status: profile.kycStatus,
      submittedAt: profile.kycSubmittedAt,
      reviewedAt: profile.kycReviewedAt,
      rejectionReason: profile.kycRejectionReason,
      selfieUrl: profile.selfieUrl,
      hasBvn: !!profile.bvnEncrypted,
      hasNin: !!profile.ninEncrypted,
    };
  }

  /**
   * Decrypt that doesn't blow up the admin review screen if env keys are
   * misconfigured. Logs the failure and returns null. The admin can still
   * see the rest of the record.
   */
  private tryDecrypt(
    ciphertext: string | null,
    targetUserId: string,
    label: string,
  ): string | null {
    if (!ciphertext) return null;
    try {
      return decryptKyc(ciphertext);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt ${label} for KYC review userId=${targetUserId}: ` +
          `${(err as Error).message}`,
      );
      return null;
    }
  }
}
