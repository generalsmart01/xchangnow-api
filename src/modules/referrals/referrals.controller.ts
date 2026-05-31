// src/modules/referrals/referrals.controller.ts

/**
 * ─── Endpoints ──────────────────────────────────────────────────────────────
 *
 *   GET    /referrals/me              JWT
 *                                     200: { code, shareUrl, totalReferees,
 *                                            totalEarningsNgn }
 *
 *   GET    /referrals/me/referees     JWT, query: page/pageSize
 *                                     200: { referees[], total, page, pageSize }
 *                                     Each referee row includes
 *                                     totalEarnedFromThemNgn so the FE can
 *                                     show per-person earnings.
 *
 *   GET    /referrals/me/earnings     JWT, query: page/pageSize
 *                                     200: { earnings[], total, page, pageSize }
 *                                     Raw commission ledger.
 *
 * All read-only. Commission credits happen inside transaction completion
 * flows (transactions.markCompleted + payouts.updateStatus on PAID), not
 * here.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LogMessage } from '../../common/decorators/log-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ListReferralsQueryDto } from './dto/list-referrals-query.dto';
import { ReferralsService } from './referrals.service';

@ApiTags('Referrals')
@ApiBearerAuth('JWT-auth')
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me')
  @LogMessage('Fetched my referral overview')
  @ApiOperation({
    summary: 'My referral summary widget',
    description:
      'Returns the code + share URL + headline stats (total referees, total ' +
      "NGN earned). One call for the dashboard widget — list endpoints below " +
      'are for the deep-dive views.',
  })
  @ApiResponse({
    status: 200,
    description: 'Referral overview.',
    schema: {
      example: {
        code: 'XCN-A8K2P9',
        shareUrl: 'https://app.xchangnow.com/register?ref=XCN-A8K2P9',
        totalReferees: 7,
        totalEarningsNgn: '1284.50',
      },
    },
  })
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.referrals.getMyOverview(user.id);
  }

  @Get('me/referees')
  @LogMessage('Listed my referees')
  @ApiOperation({
    summary: 'List users I referred',
    description:
      'Paginated, newest first. Each row includes ' +
      '`totalEarnedFromThemNgn` so the FE can render "you\'ve earned ₦X ' +
      'from this person" inline. Anonymized accounts are excluded.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        referees: [
          {
            id: 'cmpg...',
            email: 'tunde@example.com',
            firstName: 'Tunde',
            lastName: 'Bello',
            joinedAt: '2026-05-22T13:00:00.000Z',
            totalEarnedFromThemNgn: '450.00',
          },
        ],
        total: 7,
        page: 1,
        pageSize: 20,
      },
    },
  })
  listReferees(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListReferralsQueryDto,
  ) {
    return this.referrals.listMyReferees(user.id, query);
  }

  @Get('me/earnings')
  @LogMessage('Listed my referral earnings')
  @ApiOperation({
    summary: 'List my referral commission rows',
    description:
      'Raw commission ledger — one row per qualifying transaction (0.1% of ' +
      'fiatAmount on BUY/SELL completion). Newest first.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        earnings: [
          {
            id: 'cmpg...',
            referrerId: 'cmpg...',
            refereeId: 'cmpg...',
            transactionId: 'cmpg...',
            amount: '290.00',
            basisAmount: '290000.00',
            basisCurrency: 'NGN',
            ratePercent: '0.0010',
            createdAt: '2026-05-22T15:00:00.000Z',
          },
        ],
        total: 12,
        page: 1,
        pageSize: 20,
      },
    },
  })
  listEarnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListReferralsQueryDto,
  ) {
    return this.referrals.listMyEarnings(user.id, query);
  }
}
