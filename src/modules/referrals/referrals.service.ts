// src/modules/referrals/referrals.service.ts

/**
 * ReferralsService — reads the referral graph + commission ledger for the
 * authenticated user.
 *
 * Does NOT write anything itself — referral binding happens at
 * `auth.service.register`, commission credits happen inside the
 * `transactions.service.markCompleted` and `payouts.service.updateStatus`
 * $transactions. Centralizing writes near the trigger points keeps the
 * atomicity property visible at the call site.
 *
 * Public surface:
 *   - getMyOverview(userId)       summary widget: code + share URL + totals
 *   - listMyReferees(userId, q)   paginated list of users I referred
 *   - listMyEarnings(userId, q)   paginated list of commissions I earned
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralCommission } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ListReferralsQueryDto } from './dto/list-referrals-query.dto';

// The FE-facing summary widget shape. `shareUrl` is built server-side so
// the FE doesn't need to know the canonical signup URL pattern (one less
// thing for them to keep in sync).
export interface ReferralOverview {
  code: string;
  shareUrl: string;
  totalReferees: number;
  totalEarningsNgn: string; // Decimal stringified (preserves precision)
}

// Per-row shape returned by listMyReferees. Names + email so the FE can
// render a "your referrals" table. firstName/lastName are NOT masked here
// — these are referees of the caller, and the caller already invited them
// (they typed their referral code at signup).
export interface MyRefereeRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  joinedAt: Date;
  totalEarnedFromThemNgn: string;
}

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dashboard summary widget — single call, everything the "your referrals"
   * card on the user's home screen needs.
   */
  async getMyOverview(userId: string): Promise<ReferralOverview> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.referralCode) {
      // Defensive — every user-creation path sets a code. If we ever see
      // this fire, it means an old row escaped the seed backfill.
      throw new NotFoundException('Referral code not assigned');
    }

    const [totalReferees, earningsAggregate] = await Promise.all([
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.referralCommission.aggregate({
        where: { referrerId: userId },
        _sum: { amount: true },
      }),
    ]);

    const total = earningsAggregate._sum.amount ?? new Prisma.Decimal(0);

    // Build the share URL from FRONTEND_URL env. The FE will need to
    // implement a /register page that reads the `?ref=` query param and
    // pre-fills the referral code field.
    const frontendUrl =
      process.env.FRONTEND_URL?.split(',')[0]?.trim() ?? 'http://localhost:3001';
    const shareUrl = `${frontendUrl}/register?ref=${user.referralCode}`;

    return {
      code: user.referralCode,
      shareUrl,
      totalReferees,
      totalEarningsNgn: total.toFixed(2),
    };
  }

  /**
   * Paginated list of users referred by the caller, newest first.
   * Includes per-referee earnings so the FE table can show "Tunde — joined
   * 3 days ago — you've earned ₦1,200 from his trades".
   */
  async listMyReferees(
    userId: string,
    query: ListReferralsQueryDto,
  ): Promise<{
    referees: MyRefereeRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.UserWhereInput = {
      referredById: userId,
      // Exclude anonymized accounts from the visible list — the caller
      // doesn't need to see a "[DELETED] [USER]" row in their referrals tab.
      deletedAt: null,
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          createdAt: true,
          profile: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    // Per-referee earnings rollup. Single grouped query against
    // referral_commissions, scoped to the rows we're returning, keeps this
    // O(1) extra DB call regardless of pageSize.
    const refereeIds = rows.map((r) => r.id);
    const perRefereeSums = refereeIds.length
      ? await this.prisma.referralCommission.groupBy({
          by: ['refereeId'],
          where: { referrerId: userId, refereeId: { in: refereeIds } },
          _sum: { amount: true },
        })
      : [];
    const earnedByReferee = new Map(
      perRefereeSums.map((r) => [r.refereeId, r._sum.amount ?? new Prisma.Decimal(0)]),
    );

    return {
      referees: rows.map((r) => ({
        id: r.id,
        email: r.email,
        firstName: r.profile?.firstName ?? '',
        lastName: r.profile?.lastName ?? '',
        joinedAt: r.createdAt,
        totalEarnedFromThemNgn: (
          earnedByReferee.get(r.id) ?? new Prisma.Decimal(0)
        ).toFixed(2),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Paginated commission ledger for the caller. Newest first — typical
   * "transaction-history-style" listing.
   */
  async listMyEarnings(
    userId: string,
    query: ListReferralsQueryDto,
  ): Promise<{
    earnings: ReferralCommission[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.ReferralCommissionWhereInput = { referrerId: userId };

    const [earnings, total] = await Promise.all([
      this.prisma.referralCommission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.referralCommission.count({ where }),
    ]);

    return { earnings, total, page, pageSize };
  }
}
