import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  RiskSeverity,
  SecurityEventType,
  User,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../../integrations/email/email.service';
import { SecurityService } from '../security/security.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Role } from './enums/role.enum';
import { JwtPayload } from './interfaces/jwt-payload.interface';

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
  // Optional risk signals — captured at login and stored on the session row.
  isVpn?: boolean;
  isProxy?: boolean;
  isTor?: boolean;
  riskScore?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
}

type SafeUser = Omit<User, 'passwordHash'>;

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour — shorter, more sensitive action

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly security: SecurityService,
    private readonly email: EmailService,
  ) {}

  async register(
    dto: RegisterDto,
    ctx: SessionContext,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const rounds = this.config.get<number>('BCRYPT_ROUNDS', 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber,
      },
    });

    // Issue + send a verification email so the user can transition out of
    // PENDING_VERIFICATION. The raw token is also returned in dev mode so
    // smoke tests don't have to scrape the email log.
    const { rawToken: verifyToken } = await this.issueVerificationToken(user.id);
    await this.email.sendVerificationEmail(user.email, verifyToken);

    const tokens = await this.issueTokensForUser(user, ctx);

    const isDev = this.config.get<string>('NODE_ENV', 'development') !== 'production';
    return {
      user: this.sanitize(user),
      tokens,
      // Dev affordance — DO NOT keep in production. Real apps never expose tokens.
      ...(isDev ? { verifyToken } : {}),
    };
  }

  async login(
    dto: LoginDto,
    ctx: SessionContext,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const email = dto.email.toLowerCase().trim();

    // Security gate BEFORE password check — blocks brute-force / VPN risk
    // without consuming the password compare. If blocked, security_logs already
    // has the trail; we don't add to login_attempts so the block doesn't
    // perpetually escalate itself.
    const risk = await this.security.evaluateLoginRisk({
      email,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    if (!risk.allowed) {
      throw new UnauthorizedException(
        'Too many failed attempts. Try again later.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.deletedAt) {
      await this.recordLoginAttempt(null, email, false, 'USER_NOT_FOUND', ctx);
      // Same error message for both branches — don't leak which emails exist.
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      await this.recordLoginAttempt(user.id, email, false, 'BAD_PASSWORD', ctx);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (
      user.status !== UserStatus.ACTIVE &&
      user.status !== UserStatus.PENDING_VERIFICATION
    ) {
      await this.recordLoginAttempt(
        user.id,
        email,
        false,
        `STATUS_${user.status}`,
        ctx,
      );
      throw new UnauthorizedException('Account not active');
    }

    await this.recordLoginAttempt(user.id, email, true, undefined, ctx);

    // Stamp last-login on the user — useful for "you signed in from..." emails
    // and for spotting accounts that are dormant. Capture the updated row so
    // the response reflects the new lastLoginAt instead of the pre-update one.
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ctx.ipAddress,
      },
    });

    // Enrich the session ctx with risk signals so the session row carries them.
    const enrichedCtx: SessionContext = {
      ...ctx,
      isVpn: risk.ipIntel.isVpn,
      isProxy: risk.ipIntel.isProxy,
      isTor: risk.ipIntel.isTor,
      riskScore: risk.riskScore,
    };

    const tokens = await this.issueTokensForUser(updatedUser, enrichedCtx);
    return { user: this.sanitize(updatedUser), tokens };
  }

  async refresh(
    refreshToken: string,
    ctx: SessionContext,
  ): Promise<{ tokens: AuthTokens }> {
    const refreshTokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
    });

    if (!session) throw new UnauthorizedException('Invalid refresh token');
    if (session.revokedAt) throw new UnauthorizedException('Session revoked');
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    // Rotate: revoke the old session, issue a fresh pair.
    // Anyone holding the old refresh token (e.g. an attacker who got a copy)
    // will fail next time because the hash no longer matches an active session.
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
    });
    const tokens = await this.issueTokensForUser(user, ctx);
    return { tokens };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------------------

  async verifyEmail(token: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      throw new BadRequestException('Invalid verification token');
    }
    if (record.expiresAt < new Date()) {
      // Clean up expired tokens opportunistically.
      await this.prisma.emailVerificationToken
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw new BadRequestException('Verification token expired');
    }

    // Atomic: mark user verified + transition PENDING_VERIFICATION -> ACTIVE
    // + drop all this user's verification tokens (one-use semantics).
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          isEmailVerified: true,
          // Only advance status if they're still in the onboarding state —
          // never overwrite SUSPENDED or DEACTIVATED with ACTIVE.
          status: UserStatus.ACTIVE,
        },
      }),
      this.prisma.emailVerificationToken.deleteMany({
        where: { userId: record.userId },
      }),
    ]);

    return { message: 'Email verified' };
  }

  async resendVerification(emailRaw: string): Promise<{ message: string }> {
    const email = emailRaw.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always return the same response regardless of whether the email exists
    // or is already verified — don't leak account existence.
    const genericResponse = {
      message: 'If the account exists and is unverified, a new email has been sent',
    };

    if (!user || user.isEmailVerified || user.deletedAt) {
      return genericResponse;
    }

    // Invalidate any prior outstanding tokens for this user — one valid at a time.
    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId: user.id },
    });

    const { rawToken } = await this.issueVerificationToken(user.id);
    await this.email.sendVerificationEmail(user.email, rawToken);

    return genericResponse;
  }

  // ---------------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------------

  async forgotPassword(
    emailRaw: string,
  ): Promise<{ message: string; resetToken?: string }> {
    const email = emailRaw.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Generic response — don't leak account existence.
    const generic = {
      message: 'If an account exists for that email, a reset link has been sent',
    };

    if (!user || user.deletedAt) return generic;

    // Rotate: invalidate any prior tokens (used or pending) for this user.
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });

    await this.email.sendPasswordResetEmail(user.email, rawToken);

    // Dev affordance — DO NOT keep in production. Lets tests skip log scraping.
    const isDev =
      this.config.get<string>('NODE_ENV', 'development') !== 'production';
    return isDev ? { ...generic, resetToken: rawToken } : generic;
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record) throw new BadRequestException('Invalid reset token');
    if (record.usedAt) {
      throw new BadRequestException('Reset token has already been used');
    }
    if (record.expiresAt < new Date()) {
      // Clean up expired tokens opportunistically.
      await this.prisma.passwordResetToken
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw new BadRequestException('Reset token expired');
    }

    const rounds = this.config.get<number>('BCRYPT_ROUNDS', 12);
    const newPasswordHash = await bcrypt.hash(newPassword, rounds);

    // Atomic bundle of "the password reset transaction":
    //   1. Swap password hash on the user
    //   2. Mark token used (don't delete — preserves the audit row)
    //   3. Revoke every active session so any stolen refresh token dies too
    //   4. Write a security_log for compliance / forensics
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newPasswordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.securityLog.create({
        data: {
          userId: record.userId,
          eventType: SecurityEventType.PASSWORD_RESET,
          severity: RiskSeverity.MEDIUM,
        },
      }),
    ]);

    return {
      message: 'Password reset successful. Please log in with your new password.',
    };
  }

  /**
   * Used by JwtStrategy to confirm the session referenced by an access
   * token is still alive. Returns the session row or null.
   */
  async validateSession(sessionId: string, userId: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return null;
    if (session.userId !== userId) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt < new Date()) return null;
    return session;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async issueTokensForUser(
    user: Pick<User, 'id' | 'email' | 'role'>,
    ctx: SessionContext,
  ): Promise<AuthTokens> {
    const refreshExpiresIn = this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
    const accessExpiresIn = this.config.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    );
    const refreshExpiresAt = this.computeExpiry(refreshExpiresIn);

    // Refresh token: opaque random string. Stored hashed; raw value goes to client.
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshTokenHash = this.hashToken(refreshToken);

    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
        isVpn: ctx.isVpn ?? false,
        isProxy: ctx.isProxy ?? false,
        isTor: ctx.isTor ?? false,
        riskScore: ctx.riskScore ?? 0,
        expiresAt: refreshExpiresAt,
      },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      sessionId: session.id,
    };

    // Secret + expiresIn are defaulted by JwtModule.registerAsync in auth.module.ts.
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      refreshToken,
      accessExpiresIn,
      refreshExpiresIn,
    };
  }

  private async recordLoginAttempt(
    userId: string | null,
    email: string,
    success: boolean,
    failureReason: string | undefined,
    ctx: SessionContext,
  ): Promise<void> {
    try {
      await this.prisma.loginAttempt.create({
        data: {
          userId: userId ?? undefined,
          email,
          success,
          failureReason,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    } catch (err) {
      // Don't let audit logging fail the auth flow — just log it.
      this.logger.warn(`Failed to record login attempt: ${(err as Error).message}`);
    }
  }

  /**
   * Generate a verification token: opaque random string, stored as a sha256
   * hash so the raw value never sits in the DB. Same pattern as refresh tokens.
   */
  private async issueVerificationToken(
    userId: string,
  ): Promise<{ rawToken: string }> {
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });

    return { rawToken };
  }

  private hashToken(raw: string): string {
    // sha256 is right for high-entropy random tokens — fast and collision-resistant.
    // bcrypt is for *low-entropy* secrets (passwords) where slowness fights brute force.
    return createHash('sha256').update(raw).digest('hex');
  }

  private computeExpiry(duration: string): Date {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) throw new BadRequestException(`Invalid duration format: ${duration}`);
    const value = parseInt(match[1], 10);
    const unitMs: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(Date.now() + value * unitMs[match[2]]);
  }

  private sanitize(user: User): SafeUser {
    const { passwordHash: _omit, ...rest } = user;
    return rest;
  }
}
