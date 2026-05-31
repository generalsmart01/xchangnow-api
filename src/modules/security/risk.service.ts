// src/modules/security/risk.service.ts

/**
 * RiskService — pure scoring layer.
 *
 * Given IP intelligence + recent failed attempts, produces a 0-100 risk
 * score and a severity bucket (LOW / MEDIUM / HIGH / CRITICAL). No side
 * effects — no DB, no network calls. SecurityService composes this with
 * its own DB-backed counters to produce the final allow/deny decision.
 *
 * Scoring weights are co-located here intentionally; tuning is one file
 * to read + one test to update.
 */

import { Injectable } from '@nestjs/common';
import { RiskSeverity } from '@prisma/client';
import { IpIntel } from '../../integrations/ip-intel/ip-intel.service';

export interface RiskInput {
  ipIntel: IpIntel;
  recentFailedAttempts: number;
}

@Injectable()
export class RiskService {
  /**
   * Compose a 0-100 risk score from signals.
   *   - Tor exit:   +50
   *   - VPN:        +30
   *   - Proxy:      +25
   *   - Failed attempts in window: +20 each, capped at 100
   * Capped at 100 overall.
   */
  score(input: RiskInput): number {
    let s = 0;

    if (input.ipIntel.isTor) s += 50;
    else if (input.ipIntel.isVpn) s += 30;
    else if (input.ipIntel.isProxy) s += 25;

    s += Math.min(input.recentFailedAttempts * 20, 100);

    return Math.min(s, 100);
  }

  severity(score: number): RiskSeverity {
    if (score >= 75) return RiskSeverity.CRITICAL;
    if (score >= 50) return RiskSeverity.HIGH;
    if (score >= 25) return RiskSeverity.MEDIUM;
    return RiskSeverity.LOW;
  }
}
