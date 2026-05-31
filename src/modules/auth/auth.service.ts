// src/modules/auth/auth.service.ts

/**
 * Owns every step of the user authentication + recovery lifecycle:
 *
 *   - register            create an account (no tokens issued; verify first)
 *   - verifyEmail         consume an email-verification token, flip to ACTIVE
 *   - resendVerification  issue a fresh verification token (generic response)
 *   - login               authenticate + issue access/refresh tokens
 *   - refresh             rotate the refresh token, issue a new pair
 *   - logout              revoke the current session
 *   - forgotPassword      issue a 1h password-reset token (generic response)
 *   - resetPassword       consume reset token, rotate password, kill all sessions
 *   - acceptInvite        staff sets their password from an invite link
 *   - issueInviteToken    helper used by StaffService when inviting staff
 *   - validateSession     called by JwtStrategy on every protected request
 *
 * Token handling (verify / reset / invite) follows a single pattern:
 *   1. Generate a 32-byte random token (raw) → sent to the user
 *   2. SHA-256 hash the raw token → stored in DB (so a DB leak doesn't grant
 *      account takeover; the email is the only place the raw token exists)
 *   3. Hash incoming tokens on use, look up by hash, check expiry + usedAt
 *
 * Security properties enforced here (not just in controllers):
 *   - Strict login gate — only ACTIVE users can authenticate
 *   - Password resets revoke ALL sessions atomically (rotated refresh tokens
 *     from before the reset can no longer be exchanged)
 *   - Login risk evaluation BEFORE password compare to protect against
 *     credential-stuffing exhausting the bcrypt budget
 *   - Generic responses on resend-verification and forgot-password so an
 *     attacker can't enumerate registered emails
 *   - Email + phone both stored in dual form (raw + normalized); all lookups
 *     hit the normalized column for case- and format-insensitive matching
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  Prisma,
  RiskSeverity,
  SecurityEventType,
  User,
  UserRole,
  UserStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../../database/prisma.service";
import { flattenUser, SafeUser } from "../../common/utils/flatten-user";
import { generateReferralCode } from "../../common/utils/generate-referral-code";
import { normalizeEmail } from "../../common/utils/normalize-email";
import { normalizePhoneE164 } from "../../common/utils/normalize-phone";
import { EmailService } from "../../integrations/email/email.service";
import { SecurityService } from "../security/security.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { Role } from "./enums/role.enum";
import { JwtPayload } from "./interfaces/jwt-payload.interface";

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

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour — shorter, more sensitive action
const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — invites take longer to act on than password resets

/**
 * AuthService — the authoritative source of truth for "who is this user
 * and may they do this?". Owns password hashing, token issuance + rotation,
 * session lifecycle, and the lookups behind every login / recovery flow.
 *
 * Direct collaborators:
 *   - PrismaService    — DB reads/writes (users, sessions, *_tokens, security_logs)
 *   - JwtService       — sign/verify access tokens
 *   - SecurityService  — pre-login risk gate (VPN/proxy/brute-force checks)
 *   - EmailService     — verification, password-reset, invite emails
 *
 * Not a collaborator (intentionally): PiiAccessLogService. Auth flows touch
 * the user's OWN data, which the PII rulebook explicitly excludes from
 * access logging — that table is for tracking when staff/admins read OTHER
 * users' PII. Self-reads are normal app usage and would just create noise.
 */
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

  /**
   * Register a brand-new USER account.
   *
   * Business rules enforced here:
   *   - Strict gate: NO tokens are issued. The new user goes straight to
   *     PENDING_VERIFICATION and must click the email link → call
   *     /auth/login to actually get session tokens. The pre-strict-gate
   *     version issued tokens immediately; we removed that to ensure
   *     anyone who can authenticate has demonstrably controlled their inbox.
   *   - Email + phone both normalized: the raw input is stored for display,
   *     the canonical form (lowercased email / E.164 phone) is stored for
   *     uniqueness. Duplicate registrations in different cases or phone
   *     formats are caught with 409 (not 500).
   *   - User and Profile are created in a single nested write — so we never
   *     end up with a User row without its companion Profile.
   *   - Referral handling: a unique XCN-XXXXXX `referralCode` is minted for
   *     the new user (always). If `dto.referralCode` is supplied, it's
   *     resolved against existing User.referralCode rows (case-insensitive);
   *     unknown codes are rejected with 400 to avoid silent attribution loss.
   *     On success, `User.referredById` is bound — ONE-TIME, immutable.
   *
   * @returns The created user + (dev only) the raw verifyToken so smoke
   *   tests don't have to scrape the email log to complete the flow.
   * @throws ConflictException 409 — email, phone, or (vanishingly rare)
   *         referral code already in use (distinguishes which via message)
   * @throws BadRequestException 400 — email parse failed OR supplied
   *         referralCode is unknown
   */
  async register(
    dto: RegisterDto,
  ): Promise<{ user: SafeUser; verifyToken?: string }> {
    // No session ctx parameter here anymore. Register doesn't issue tokens —
    // strict flow requires the user to verify their email first, then call
    // /auth/login (which is where session/ip risk signals get captured).
    //
    // Email stored as TWO fields:
    //   - `email`           = the raw input (preserves what the user typed)
    //   - `emailNormalized` = lowercased + trimmed; used for uniqueness +
    //                         every login/recovery lookup
    const rawEmail = dto.email.trim();
    const emailNormalized = normalizeEmail(dto.email);
    if (!emailNormalized) {
      // Defensive — @IsEmail should have already rejected garbage input.
      throw new BadRequestException("Email is not valid");
    }

    const existing = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });
    if (existing) throw new ConflictException("Email already registered");

    const rounds = this.config.get<number>("BCRYPT_ROUNDS", 12);
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    // The email pre-check above gives fast, clean feedback for the common case,
    // but two unique columns can still collide here:
    //   - profiles.phone_number (no pre-check at all)
    //   - users.email (race window between the pre-check and the create)
    // Catch P2002 from the create itself so both cases surface as a 409, not a
    // 500. err.meta.target tells us which column collided.
    //
    // User + Profile created in a nested write — atomic at the DB level so we
    // never end up with a User row without its Profile.
    // Normalize phone NOW so we can store both forms atomically. The validator
    // (@IsPhoneNumberE164) has already confirmed the input is parseable, so
    // normalizePhoneE164 returning null here would be a real bug — but we
    // tolerate it (=> null on both fields) rather than throwing 500.
    const phoneNumberNormalized = normalizePhoneE164(dto.phoneNumber);

    // Referral binding: if the user supplied a code, resolve it to a
    // referrer. Unknown code → 400 (don't silently drop the attribution).
    // Codes are matched case-insensitively so users can type them in any
    // case without losing referrer credit.
    let referredById: string | null = null;
    if (dto.referralCode) {
      const normalizedCode = dto.referralCode.trim().toUpperCase();
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: normalizedCode },
        select: { id: true },
      });
      if (!referrer) {
        throw new BadRequestException(
          `Unknown referral code: ${dto.referralCode}`,
        );
      }
      referredById = referrer.id;
    }

    // Mint a unique referral code for the new user. Collisions are extremely
    // rare (~0.011% at 100k users) but theoretically possible — handled by
    // the P2002 catch block below same as email/phone collisions.
    const referralCode = generateReferralCode();

    let user: Prisma.UserGetPayload<{ include: { profile: true } }>;
    try {
      user = await this.prisma.user.create({
        data: {
          email: rawEmail,
          emailNormalized,
          passwordHash,
          referralCode,
          referredById,
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
        err.code === "P2002"
      ) {
        const target = (err.meta?.target as string[] | undefined)?.[0];
        // The unique constraint moved from `phone_number` to
        // `phone_number_normalized` so two users can't register the same
        // number in different formats (e.g. "08012..." vs "+23480...").
        if (target === "phone_number_normalized") {
          throw new ConflictException("Phone number already registered");
        }
        // Uniqueness moved from `email` to `email_normalized` — same reason
        // as the phone migration (catch case-variant duplicates).
        if (target === "email_normalized") {
          throw new ConflictException("Email already registered");
        }
        if (target === "referral_code") {
          // Astronomically rare collision (~0.011% at 100k users). Surface
          // a 500-equivalent so the caller retries the whole request; we
          // don't retry inline because the password hash compute is wasted.
          throw new ConflictException(
            "Generated referral code collided. Please retry registration.",
          );
        }
        throw new ConflictException("Account already exists");
      }
      throw err;
    }

    this.logger.log(`Registered user id=${user.id} email=${user.email}`);

    // Issue + send a verification email so the user can transition out of
    // PENDING_VERIFICATION. The raw token is also returned in dev mode so
    // smoke tests don't have to scrape the email log.
    const { rawToken: verifyToken } = await this.issueVerificationToken(
      user.id,
    );
    await this.email.sendVerificationEmail(user.email, verifyToken);

    const isDev =
      this.config.get<string>("NODE_ENV", "development") !== "production";
    return {
      user: this.sanitize(user),
      // Dev affordance — DO NOT keep in production. Real apps never expose tokens.
      ...(isDev ? { verifyToken } : {}),
    };
  }

  /**
   * Authenticate a user and issue an access+refresh token pair.
   *
   * Flow:
   *   1. Normalize the email (case-insensitive lookup)
   *   2. Run risk evaluation BEFORE the password compare — this is the
   *      "save bcrypt CPU" optimization. A flood of brute-force attempts
   *      from a hostile IP gets rejected without burning the (deliberately
   *      slow) bcrypt budget.
   *   3. Constant-time password check via bcrypt.compare
   *   4. Status gate — only ACTIVE users may log in; PENDING_VERIFICATION
   *      gets a specific message so the FE can route to "Resend verification"
   *   5. Stamp lastLoginAt + lastLoginIp on the user row
   *   6. Issue tokens, persist the session (refresh token hash, not the
   *      raw token — same hashing pattern as verify/reset tokens)
   *
   * Every login attempt — success OR fail — is recorded in `login_attempts`
   * for fraud monitoring. The SAME 401 message ("Email or password
   * incorrect") is returned for missing-user and bad-password cases so an
   * attacker can't enumerate registered emails via differential responses.
   *
   * @throws UnauthorizedException 401 with one of:
   *   - "Email or password incorrect" (bad creds OR no such user)
   *   - "Please verify your email before logging in..." (unverified)
   *   - "Account not active" (suspended/deactivated)
   *   - "Too many failed attempts..." (risk gate blocked)
   */
  async login(
    dto: LoginDto,
    ctx: SessionContext,
  ): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    // Always look up users by the normalized form so case variants
    // ("USER@x.com" vs "user@x.com") resolve to the same account.
    const emailNormalized = normalizeEmail(dto.email);
    if (!emailNormalized) {
      // Treat malformed input as "no such user" — generic 401, same as a
      // wrong password, to avoid revealing which emails exist.
      throw new UnauthorizedException("Email or password incorrect");
    }

    // Security gate BEFORE password check — blocks brute-force / VPN risk
    // without consuming the password compare. If blocked, security_logs already
    // has the trail; we don't add to login_attempts so the block doesn't
    // perpetually escalate itself.
    const risk = await this.security.evaluateLoginRisk({
      email: emailNormalized,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    if (!risk.allowed) {
      throw new UnauthorizedException(
        "Too many failed attempts. Try again later.",
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });

    if (!user || user.deletedAt) {
      await this.recordLoginAttempt(
        null,
        emailNormalized,
        false,
        "USER_NOT_FOUND",
        ctx,
      );
      // Same error message for both branches — don't leak which emails exist.
      throw new UnauthorizedException("Email or password incorrect");
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      await this.recordLoginAttempt(
        user.id,
        emailNormalized,
        false,
        "BAD_PASSWORD",
        ctx,
      );
      throw new UnauthorizedException("Invalid credentials");
    }

    // Strict email-verification gate: only ACTIVE users may log in.
    // PENDING_VERIFICATION (just-registered, not yet verified), SUSPENDED, and
    // DEACTIVATED accounts all fall through to the same audit + 401 path. The
    // 401 message DOES distinguish the unverified case from credentials-bad,
    // because the right next action is different — go check your inbox / resend
    // verification, not "try a different password".
    if (user.status !== UserStatus.ACTIVE) {
      await this.recordLoginAttempt(
        user.id,
        emailNormalized,
        false,
        `STATUS_${user.status}`,
        ctx,
      );
      if (user.status === UserStatus.PENDING_VERIFICATION) {
        throw new UnauthorizedException(
          'Please verify your email before logging in. Check your inbox or request a new verification email.',
        );
      }
      throw new UnauthorizedException('Account not active');
    }

    await this.recordLoginAttempt(user.id, emailNormalized, true, undefined, ctx);

    // Stamp last-login on the user — useful for "you signed in from..." emails
    // and for spotting accounts that are dormant. Capture the updated row so
    // the response reflects the new lastLoginAt instead of the pre-update one.
    // include profile so sanitize() can flatten it into the response.
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ctx.ipAddress,
      },
      include: { profile: true },
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
    this.logger.log(
      `Login success id=${updatedUser.id} email=${updatedUser.email} ip=${ctx.ipAddress ?? "-"}`,
    );
    return { user: this.sanitize(updatedUser), tokens };
  }

  /**
   * Rotate refresh + access tokens.
   *
   * Refresh-token rotation is the standard defence against token theft: every
   * call revokes the old session row and issues a brand-new pair. If an
   * attacker stole a refresh token, exactly ONE of {attacker, legitimate
   * user} can successfully refresh — the next attempt from the other party
   * gets 401. The legitimate user notices their session was killed and the
   * incident is discoverable in `user_sessions.revoked_at`.
   *
   * @throws UnauthorizedException 401 — token unknown, session revoked, or
   *   session expired (refresh window elapsed since last login/rotation)
   */
  async refresh(
    refreshToken: string,
    ctx: SessionContext,
  ): Promise<{ tokens: AuthTokens }> {
    const refreshTokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
    });

    if (!session) throw new UnauthorizedException("Invalid refresh token");
    if (session.revokedAt) throw new UnauthorizedException("Session revoked");
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException("Session expired");
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

  /**
   * Revoke a single session. Idempotent — calling on an already-revoked
   * session is a no-op (the `revokedAt: null` filter makes the updateMany
   * match zero rows). Other sessions for the same user are unaffected; for
   * "log out from all devices" use the password-reset flow or a future
   * dedicated `revokeAllSessions` method.
   */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.log(`Session revoked sessionId=${sessionId}`);
  }

  // ---------------------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------------------

  /**
   * Consume an email-verification token. On success: user transitions
   * PENDING_VERIFICATION → ACTIVE, isEmailVerified flips to true, and ALL
   * outstanding verification tokens for the user are deleted (one-shot
   * semantics — a leaked email link can't be reused).
   *
   * @throws BadRequestException 400 — token unknown or expired
   */
  async verifyEmail(token: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      throw new BadRequestException("Invalid verification token");
    }
    if (record.expiresAt < new Date()) {
      // Clean up expired tokens opportunistically.
      await this.prisma.emailVerificationToken
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw new BadRequestException("Verification token expired");
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

    this.logger.log(`Email verified userId=${record.userId}`);
    return { message: "Email verified" };
  }

  /**
   * Issue a fresh verification token + send the email. Always returns the
   * same generic message regardless of whether the email exists, is already
   * verified, or has been deleted — this defeats account enumeration via
   * differential responses.
   *
   * Server-side: invalidates any prior outstanding verification tokens for
   * the user (one valid token at a time per user).
   */
  async resendVerification(emailRaw: string): Promise<{ message: string }> {
    // Always return the same response regardless of whether the email exists
    // or is already verified — don't leak account existence.
    const genericResponse = {
      message:
        "If the account exists and is unverified, a new email has been sent",
    };

    const emailNormalized = normalizeEmail(emailRaw);
    if (!emailNormalized) return genericResponse;

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });

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

  /**
   * Start a password reset. Same enumeration-resistant pattern as
   * resendVerification — generic message regardless of whether the email
   * is registered.
   *
   * Issues a 1-hour reset token (shorter than verification's 24h because
   * password reset is a more sensitive action — the smaller window reduces
   * the attack surface if a link is leaked). In dev mode the raw token is
   * also returned in the response for testing.
   */
  async forgotPassword(
    emailRaw: string,
  ): Promise<{ message: string; resetToken?: string }> {
    // Generic response — don't leak account existence.
    const generic = {
      message:
        "If an account exists for that email, a reset link has been sent",
    };

    const emailNormalized = normalizeEmail(emailRaw);
    if (!emailNormalized) return generic;

    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });

    if (!user || user.deletedAt) return generic;

    // Rotate: invalidate any prior tokens (used or pending) for this user.
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });

    await this.email.sendPasswordResetEmail(user.email, rawToken);
    this.logger.log(`Password reset token issued userId=${user.id}`);

    // Dev affordance — DO NOT keep in production. Lets tests skip log scraping.
    const isDev =
      this.config.get<string>("NODE_ENV", "development") !== "production";
    return isDev ? { ...generic, resetToken: rawToken } : generic;
  }

  /**
   * Finalize a password reset.
   *
   * Atomic bundle:
   *   1. Swap passwordHash on the user
   *   2. Mark the reset token used (don't delete — preserve audit row)
   *   3. Revoke EVERY active session for the user — any refresh token
   *      from before the reset becomes unusable. This is the "log out
   *      from all devices" property the password-reset flow grants.
   *   4. Write a PASSWORD_RESET security_log row (MEDIUM severity) for
   *      forensic and compliance review
   *
   * @throws BadRequestException 400 — token unknown, already used, or
   *   expired (>1h after issue)
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record) throw new BadRequestException("Invalid reset token");
    if (record.usedAt) {
      throw new BadRequestException("Reset token has already been used");
    }
    if (record.expiresAt < new Date()) {
      // Clean up expired tokens opportunistically.
      await this.prisma.passwordResetToken
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw new BadRequestException("Reset token expired");
    }

    const rounds = this.config.get<number>("BCRYPT_ROUNDS", 12);
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

    this.logger.warn(
      `Password reset completed userId=${record.userId} — all sessions revoked`,
    );
    return {
      message:
        "Password reset successful. Please log in with your new password.",
    };
  }

  // ---------------------------------------------------------------------------
  // Staff invite acceptance
  // ---------------------------------------------------------------------------

  /**
   * Called by the invited staff member via POST /auth/accept-invite. Atomically:
   *   1. Sets their password (bcrypt-hashed)
   *   2. Flips status PENDING_VERIFICATION → ACTIVE
   *   3. Sets isEmailVerified=true (the act of clicking the invite link from
   *      their inbox proves email ownership)
   *   4. Marks the invite token used (preserved for audit, not deleted)
   *   5. Writes a security_log entry (ADMIN_OVERRIDE / MEDIUM — privileged role
   *      activation)
   *
   * Does NOT issue tokens here — staff must POST /auth/login afterwards. This
   * keeps the flow explicit and means the invite link can't be silently used
   * to gain a session.
   */
  async acceptInvite(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.inviteToken.findUnique({
      where: { tokenHash },
    });

    if (!record) throw new BadRequestException("Invalid invite token");
    if (record.usedAt) {
      throw new BadRequestException("Invite token has already been used");
    }
    if (record.expiresAt < new Date()) {
      // Opportunistic cleanup, matches reset-token pattern.
      await this.prisma.inviteToken
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw new BadRequestException("Invite token expired");
    }

    const rounds = this.config.get<number>("BCRYPT_ROUNDS", 12);
    const newPasswordHash = await bcrypt.hash(newPassword, rounds);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: newPasswordHash,
          status: UserStatus.ACTIVE,
          isEmailVerified: true,
        },
      }),
      this.prisma.inviteToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.securityLog.create({
        data: {
          userId: record.userId,
          eventType: SecurityEventType.ADMIN_OVERRIDE,
          severity: RiskSeverity.MEDIUM,
          metadata: {
            action: "INVITE_ACCEPTED",
            role: record.role,
            invitedById: record.invitedById,
          } as never,
        },
      }),
    ]);

    this.logger.log(
      `Invite accepted userId=${record.userId} role=${record.role}`,
    );

    return {
      message:
        "Invite accepted. Your account is active — please log in with your new password.",
    };
  }

  /**
   * Issues a hashed invite token tied to (userId, invitedById, role) and
   * returns the raw token to send by email. Called by StaffService.invite.
   * Public so the staff module can call it without touching the prisma model
   * directly.
   */
  async issueInviteToken(
    userId: string,
    invitedById: string,
    role: UserRole,
  ): Promise<{ rawToken: string }> {
    // Invalidate any prior outstanding invites for this user — one valid at a
    // time. Matches the pattern in resendVerification / forgotPassword.
    await this.prisma.inviteToken.deleteMany({ where: { userId } });

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(rawToken);

    await this.prisma.inviteToken.create({
      data: {
        userId,
        invitedById,
        role,
        tokenHash,
        expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
      },
    });

    return { rawToken };
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
    user: Pick<User, "id" | "email" | "role">,
    ctx: SessionContext,
  ): Promise<AuthTokens> {
    const refreshExpiresIn = this.config.get<string>(
      "JWT_REFRESH_EXPIRES_IN",
      "7d",
    );
    const accessExpiresIn = this.config.get<string>(
      "JWT_ACCESS_EXPIRES_IN",
      "15m",
    );
    const refreshExpiresAt = this.computeExpiry(refreshExpiresIn);

    // Refresh token: opaque random string. Stored hashed; raw value goes to client.
    const refreshToken = randomBytes(48).toString("base64url");
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
      this.logger.warn(
        `Failed to record login attempt: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Generate a verification token: opaque random string, stored as a sha256
   * hash so the raw value never sits in the DB. Same pattern as refresh tokens.
   */
  private async issueVerificationToken(
    userId: string,
  ): Promise<{ rawToken: string }> {
    const rawToken = randomBytes(32).toString("base64url");
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
    return createHash("sha256").update(raw).digest("hex");
  }

  private computeExpiry(duration: string): Date {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match)
      throw new BadRequestException(`Invalid duration format: ${duration}`);
    const value = parseInt(match[1], 10);
    const unitMs: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(Date.now() + value * unitMs[match[2]]);
  }

  /**
   * Strip passwordHash + flatten the Profile relation into the wire shape.
   * Use this anywhere we return a user to the client.
   */
  private sanitize(user: Parameters<typeof flattenUser>[0]): SafeUser {
    return flattenUser(user);
  }
}
