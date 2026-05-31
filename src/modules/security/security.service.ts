// src/modules/security/security.service.ts

/**
 * SecurityService — the pre-auth risk gate consulted on every login.
 *
 * Why this lives BEFORE the password compare in AuthService.login:
 *   Bcrypt is intentionally slow (~100ms at rounds=12). An attacker
 *   running credential-stuffing through thousands of stolen email/password
 *   pairs would exhaust the server's CPU on bcrypt alone. Evaluating risk
 *   first — counting recent failures per email/IP, scoring the IP via
 *   IpIntel — lets us refuse obvious abuse in <1ms without touching bcrypt.
 *
 * What this service decides:
 *   - allowed: false  → 401 returned, NO password compare attempted, NO
 *                       login_attempt row written (to avoid the block
 *                       perpetually escalating itself)
 *   - allowed: true   → proceed to password compare; AuthService records
 *                       the attempt with whatever outcome
 *
 * Inputs feeding the score:
 *   - failed login count for this email in the last 15 min
 *   - failed login count for this IP in the last 15 min
 *   - IpIntel signals (VPN / proxy / Tor / datacenter / reputation)
 *
 * Outputs (besides allowed/blocked): the same ipIntel signals are
 * stamped on the UserSession row so the resulting session carries the
 * risk context for later analysis ("this session was created from a
 * VPN").
 */

import { Injectable, Logger } from '@nestjs/common';
import { RiskSeverity, SecurityEventType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  IpIntel,
  IpIntelService,
} from '../../integrations/ip-intel/ip-intel.service';
import { RiskService } from './risk.service';

const FAIL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export interface LoginRiskInput {
  email: string;
  ipAddress?: string;
  userAgent?: string;
  userId?: string;
}

export interface LoginRiskResult {
  allowed: boolean;
  reason?: string;
  riskScore: number;
  severity: RiskSeverity;
  ipIntel: IpIntel;
  recentFailedAttempts: number;
}

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipIntel: IpIntelService,
    private readonly risk: RiskService,
  ) {}

  /**
   * Run before authenticating a login. Combines IP reputation + recent failure
   * history into a single risk decision. CRITICAL severity → block.
   */
  async evaluateLoginRisk(input: LoginRiskInput): Promise<LoginRiskResult> {
    const ipIntel = await this.ipIntel.lookup(input.ipAddress);
    const recentFailedAttempts = await this.countRecentFailures(
      input.email,
      input.ipAddress,
    );

    const riskScore = this.risk.score({ ipIntel, recentFailedAttempts });
    const severity = this.risk.severity(riskScore);
    const allowed = severity !== RiskSeverity.CRITICAL;
    const reason = allowed ? undefined : 'BLOCKED_BY_SECURITY';

    // Only log notable signals — LOW is just noise.
    if (severity !== RiskSeverity.LOW) {
      const eventType = ipIntel.isVpn
        ? SecurityEventType.VPN_DETECTED
        : SecurityEventType.HIGH_RISK_LOGIN;
      await this.logSecurityEvent({
        userId: input.userId ?? null,
        eventType,
        severity,
        ipAddress: input.ipAddress,
        metadata: { ipIntel, recentFailedAttempts, riskScore, reason },
      });
    }

    return {
      allowed,
      reason,
      riskScore,
      severity,
      ipIntel,
      recentFailedAttempts,
    };
  }

  async logSecurityEvent(event: {
    userId: string | null;
    eventType: SecurityEventType;
    severity: RiskSeverity;
    ipAddress?: string;
    metadata?: unknown;
  }): Promise<void> {
    try {
      await this.prisma.securityLog.create({
        data: {
          userId: event.userId ?? undefined,
          eventType: event.eventType,
          severity: event.severity,
          ipAddress: event.ipAddress,
          metadata: (event.metadata as never) ?? undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write security_log: ${(err as Error).message}`,
      );
    }
  }

  private async countRecentFailures(
    email: string,
    ipAddress: string | undefined,
  ): Promise<number> {
    const since = new Date(Date.now() - FAIL_WINDOW_MS);

    const [byEmail, byIp] = await Promise.all([
      this.prisma.loginAttempt.count({
        where: { email, success: false, createdAt: { gte: since } },
      }),
      ipAddress
        ? this.prisma.loginAttempt.count({
            where: { ipAddress, success: false, createdAt: { gte: since } },
          })
        : Promise.resolve(0),
    ]);

    return Math.max(byEmail, byIp);
  }
}
