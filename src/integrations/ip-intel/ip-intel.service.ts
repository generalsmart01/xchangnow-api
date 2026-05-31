// src/integrations/ip-intel/ip-intel.service.ts

/**
 * IpIntelService — IP reputation lookup with DB-backed caching.
 *
 * For each IP we want to know: is it a VPN, a proxy, a Tor exit, a known
 * data-center IP? These signals feed the login risk gate.
 *
 * Cache strategy: results are stored in `ip_reputation_logs` with a 24h
 * TTL. A cache hit returns instantly; a miss calls the external provider
 * and stores the result. Same IP queried twice within 24h costs us one
 * external API call.
 *
 * Local/private IPs (127.x, 10.x, 192.168.x, etc.) short-circuit to a
 * "safe" response without any provider call — they can't meaningfully
 * be VPN/proxy because they're not on the public internet at all.
 *
 * If the external provider is down or rate-limits us, the service
 * returns a benign default (all flags false, riskScore 0) rather than
 * blocking login. Better to occasionally let through a VPN user than
 * to lock everyone out because our IP provider had a bad afternoon.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface IpIntel {
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  riskScore: number; // provider-reported, 0-100
  country?: string;
  asn?: string;
  cached: boolean;
}

const LOCAL_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fe80:/i,
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IpIntelService {
  private readonly logger = new Logger(IpIntelService.name);
  private readonly provider = 'stub';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look up IP reputation. Order:
   *   1. Local / private IPs → zero-risk shortcut.
   *   2. Recent cache hit in ip_reputation_logs → return.
   *   3. Fresh provider lookup → cache → return.
   *
   * The stub provider returns all-clear. Real providers (ipinfo, MaxMind)
   * plug in by replacing fetchFromProvider().
   */
  async lookup(ipAddress?: string): Promise<IpIntel> {
    if (!ipAddress || this.isLocal(ipAddress)) {
      return {
        isVpn: false,
        isProxy: false,
        isTor: false,
        riskScore: 0,
        country: 'LOCAL',
        cached: true,
      };
    }

    const cached = await this.prisma.ipReputationLog.findFirst({
      where: {
        ipAddress,
        provider: this.provider,
        checkedAt: { gte: new Date(Date.now() - CACHE_TTL_MS) },
      },
      orderBy: { checkedAt: 'desc' },
    });
    if (cached) {
      return {
        isVpn: cached.isVpn,
        isProxy: cached.isProxy,
        isTor: cached.isTor,
        riskScore: cached.riskScore,
        country: cached.country ?? undefined,
        asn: cached.asn ?? undefined,
        cached: true,
      };
    }

    const fresh = await this.fetchFromProvider(ipAddress);

    try {
      await this.prisma.ipReputationLog.upsert({
        where: { ipAddress_provider: { ipAddress, provider: this.provider } },
        update: {
          isVpn: fresh.isVpn,
          isProxy: fresh.isProxy,
          isTor: fresh.isTor,
          riskScore: fresh.riskScore,
          country: fresh.country,
          checkedAt: new Date(),
        },
        create: {
          ipAddress,
          isVpn: fresh.isVpn,
          isProxy: fresh.isProxy,
          isTor: fresh.isTor,
          riskScore: fresh.riskScore,
          country: fresh.country,
          provider: this.provider,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to cache IP reputation: ${(err as Error).message}`);
    }

    return { ...fresh, cached: false };
  }

  private async fetchFromProvider(
    _ipAddress: string,
  ): Promise<Omit<IpIntel, 'cached'>> {
    // TODO: replace with real provider call (ipinfo.io, MaxMind GeoIP2, etc.)
    return {
      isVpn: false,
      isProxy: false,
      isTor: false,
      riskScore: 0,
      country: 'UNKNOWN',
    };
  }

  private isLocal(ip: string): boolean {
    return LOCAL_PATTERNS.some((p) => p.test(ip));
  }
}
