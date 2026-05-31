// src/modules/admin/bootstrap.service.ts

/**
 * BootstrapService — the HTTP-driven alternative to `prisma db seed` for
 * minting the first SUPER_ADMIN.
 *
 * Use case: hosting tiers without shell access (Render free tier, some
 * cloud-run setups) where you can't invoke `prisma db seed` after deploy.
 * Set `BOOTSTRAP_SECRET` in the env, hit `POST /admin/bootstrap` with that
 * same secret in the body, and the first SUPER_ADMIN is created.
 *
 * Security model:
 *   - No JWT auth (impossible by definition — no SUPER_ADMIN exists yet)
 *   - Defended by a shared secret in `BOOTSTRAP_SECRET` env var
 *   - Compared timing-safely (crypto.timingSafeEqual) to defeat
 *     character-by-character probing
 *   - Endpoint pretends not to exist (404) when the env var is unset, so
 *     even the URL doesn't leak its purpose in normal deployments
 *   - SINGLE-USE: refuses with 409 once any SUPER_ADMIN row exists. The
 *     seed-script path stays usable in parallel; whichever runs first wins,
 *     the other becomes a no-op.
 *   - Failed attempts write a HIGH-severity security_log row so they're
 *     loud in any incident review
 *
 * Best practice after first successful bootstrap: REMOVE `BOOTSTRAP_SECRET`
 * from production env. The endpoint then permanently returns 404 — same
 * UX as if it never existed.
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
  RiskSeverity,
  SecurityEventType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { timingSafeEqual } from 'crypto';
import { flattenUser, SafeUser } from '../../common/utils/flatten-user';
import { generateReferralCode } from '../../common/utils/generate-referral-code';
import { normalizeEmail } from '../../common/utils/normalize-email';
import { PrismaService } from '../../database/prisma.service';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';

@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create the first SUPER_ADMIN via HTTP. See class JSDoc for the full
   * security model.
   *
   * @throws NotFoundException 404 — BOOTSTRAP_SECRET env var not set
   *   (endpoint pretends not to exist)
   * @throws ForbiddenException 403 — supplied secret doesn't match
   * @throws ConflictException 409 — a SUPER_ADMIN already exists OR the
   *   email is already taken
   * @throws BadRequestException 400 — email parse failed (defensive)
   */
  async bootstrapSuperAdmin(
    dto: BootstrapSuperAdminDto,
  ): Promise<SafeUser> {
    // 1. Endpoint is disabled if no shared secret is configured. 404 (not
    //    403) intentionally — we'd rather the URL look unmapped than
    //    advertise its existence.
    const expected = process.env.BOOTSTRAP_SECRET;
    if (!expected) {
      throw new NotFoundException('Cannot GET /admin/bootstrap');
    }

    // 2. Timing-safe secret comparison. If lengths differ, do a dummy
    //    compare so the failure path takes the same time as a successful
    //    one — prevents an attacker from inferring the secret length.
    const suppliedBuf = Buffer.from(dto.secret, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    let secretOk: boolean;
    if (suppliedBuf.length !== expectedBuf.length) {
      timingSafeEqual(expectedBuf, expectedBuf); // dummy work
      secretOk = false;
    } else {
      secretOk = timingSafeEqual(suppliedBuf, expectedBuf);
    }
    if (!secretOk) {
      // Log loudly — failed bootstrap attempts are noteworthy
      await this.recordFailedAttempt(dto.email, 'INVALID_SECRET');
      throw new ForbiddenException('Invalid bootstrap secret');
    }

    // 3. Single-use guard. If ANY SUPER_ADMIN exists, refuse — the bootstrap
    //    has already happened (via this endpoint or the seed script).
    const existing = await this.prisma.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN },
      select: { id: true, email: true },
    });
    if (existing) {
      await this.recordFailedAttempt(dto.email, 'ALREADY_BOOTSTRAPPED');
      throw new ConflictException(
        'SUPER_ADMIN already exists. Bootstrap endpoint is single-use.',
      );
    }

    // 4. Normalize email + check for collision (defensive — no users should
    //    exist yet at first bootstrap, but the seed script may have created
    //    OTHER non-SUPER_ADMIN test users in some flows).
    const emailNormalized = normalizeEmail(dto.email);
    if (!emailNormalized) {
      throw new BadRequestException('Email is not valid');
    }
    const emailCollision = await this.prisma.user.findUnique({
      where: { emailNormalized },
      select: { id: true },
    });
    if (emailCollision) {
      throw new ConflictException('Email already registered');
    }

    // 5. Hash + create. Same nested User+Profile write the regular register
    //    flow uses. Status = ACTIVE, isEmailVerified = true — admin doesn't
    //    need to verify themselves via email.
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);
    const referralCode = generateReferralCode();

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.trim(),
        emailNormalized,
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        isEmailVerified: true,
        referralCode,
        profile: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
          },
        },
      },
      include: { profile: true },
    });

    // 6. HIGH-severity security log — bootstrap is the most consequential
    //    operation in the system after anonymization. Forensic review should
    //    spot it without effort.
    await this.prisma.securityLog.create({
      data: {
        userId: user.id,
        eventType: SecurityEventType.ADMIN_OVERRIDE,
        severity: RiskSeverity.HIGH,
        metadata: {
          action: 'BOOTSTRAP_SUPER_ADMIN_CREATED',
          method: 'HTTP_ENDPOINT',
        } as never,
      },
    });

    this.logger.warn(
      `🚨 SUPER_ADMIN bootstrapped via HTTP endpoint: id=${user.id} email=${user.email}. ` +
        'REMOVE BOOTSTRAP_SECRET from env after confirming login works.',
    );

    return flattenUser(user);
  }

  /**
   * Record a failed bootstrap attempt for forensic review. Failures matter
   * even MORE than successes here — every failure indicates either a
   * misconfiguration or an attempted attack.
   *
   * Never throws (catches its own errors) so the actual auth-failure path
   * isn't disrupted by an audit-write failure.
   */
  private async recordFailedAttempt(
    attemptedEmail: string,
    reason: 'INVALID_SECRET' | 'ALREADY_BOOTSTRAPPED',
  ): Promise<void> {
    try {
      await this.prisma.securityLog.create({
        data: {
          eventType: SecurityEventType.ADMIN_OVERRIDE,
          severity: RiskSeverity.HIGH,
          metadata: {
            action: 'BOOTSTRAP_ATTEMPT_FAILED',
            reason,
            attemptedEmail,
          } as never,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to record bootstrap attempt log: ${(err as Error).message}`,
      );
    }
  }
}
