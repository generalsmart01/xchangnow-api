import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly security: SecurityService,
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
        fullName: dto.fullName,
        phoneNumber: dto.phoneNumber,
      },
    });

    const tokens = await this.issueTokensForUser(user, ctx);
    return { user: this.sanitize(user), tokens };
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
