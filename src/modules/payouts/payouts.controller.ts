// src/modules/payouts/payouts.controller.ts

/**
 * ─── Endpoints ──────────────────────────────────────────────────────────────
 *
 *  --- Customer (own payouts) ---
 *
 *   GET    /payouts/me           query: page/pageSize/status
 *                                200: { payouts[], total, page, pageSize }
 *
 *   GET    /payouts/me/:id       200: Payout with transaction + bankAccount
 *                                404: not found / not yours
 *
 *  --- Admin (ADMIN | SUPER_ADMIN) ---
 *
 *   GET    /payouts              cross-user paginated listing
 *   GET    /payouts/:id          full record
 *   PATCH  /payouts/:id/status   body: UpdatePayoutStatusDto
 *                                200: state-machine transition (atomic with side
 *                                effects — PAID cascades tx → COMPLETED)
 *                                400: invalid transition (e.g. PAID is terminal)
 *                                404: payout not found
 *
 * Only SELL transactions generate payouts (auto-created on approval).
 * BUY and SWAP complete via admin /mark-completed instead.
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LogMessage } from '../../common/decorators/log-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { UpdatePayoutStatusDto } from './dto/update-payout-status.dto';
import { PayoutsService } from './payouts.service';

const PAYOUT_EXAMPLE = {
  id: 'cmpg8s3pq000do8sknhn8myhd',
  transactionId: 'cmpg8s3180009o8sk1t0qywog',
  bankAccountId: 'cmpgx5ryo000go85kxlbxwzn7',
  amount: '290000.00',
  currency: 'NGN',
  status: 'PENDING',
  reference: 'XCN-7503C7E4',
  failureReason: null,
  processedById: null,
  processedAt: null,
  paidAt: null,
  createdAt: '2026-05-22T14:30:00.000Z',
  updatedAt: '2026-05-22T14:30:00.000Z',
  transaction: {
    id: 'cmpg8s3180009o8sk1t0qywog',
    referenceCode: 'XCN-7503C7E4',
    type: 'SELL',
    status: 'APPROVED',
    assetNetworkId: 'cmpqe002b0001o81g8k7vmpqr',
    cryptoAmount: '0.005',
    fiatAmount: '290000.00',
    assetNetwork: {
      id: 'cmpqe002b0001o81g8k7vmpqr',
      asset: { id: 'cmpqd99zz0000o81g4kq8jz5x', symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
      network: { id: 'cmpqd001a0000o81g4kq8jz5x', code: 'BITCOIN', name: 'Bitcoin', chainId: null },
    },
  },
  bankAccount: {
    bankName: 'Guaranty Trust Bank',
    accountNumber: '0123456789',
    accountName: 'Michael Adeleke',
  },
};

@ApiTags('Payouts')
@ApiBearerAuth('JWT-auth')
@Controller('payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  // ------------------------- user-facing -------------------------

  @Get('me')
  @LogMessage('Listed my payouts')
  @ApiOperation({
    summary: 'List MY payouts',
    description:
      'Returns paginated payouts attached to the caller\'s SELL transactions. ' +
      'BUY/SWAP transactions never have payouts — they complete via mark-completed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated payouts.',
    schema: {
      example: {
        payouts: [PAYOUT_EXAMPLE],
        total: 3,
        page: 1,
        pageSize: 20,
      },
    },
  })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPayoutsQueryDto,
  ) {
    return this.payouts.listMine(user.id, query);
  }

  @Get('me/:id')
  @LogMessage('Fetched my payout')
  @ApiOperation({
    summary: 'Get one of MY payouts',
    description:
      'Returns a single payout with embedded transaction + bankAccount. ' +
      '404 if the id doesn\'t exist or belongs to another user.',
  })
  @ApiResponse({ status: 200, schema: { example: PAYOUT_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Payout not found / not yours.' })
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.payouts.findMine(user.id, id);
  }

  // ---------------------------- admin ----------------------------

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Listed payouts (admin)')
  @ApiOperation({
    summary: '(Admin) List ALL payouts',
    description:
      'System-wide list for the payouts dashboard. Filter by status to ' +
      'find PENDING ones ready to process.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        payouts: [PAYOUT_EXAMPLE],
        total: 42,
        page: 1,
        pageSize: 20,
      },
    },
  })
  listAll(@Query() query: ListPayoutsQueryDto) {
    return this.payouts.listAll(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Fetched payout (admin)')
  @ApiOperation({ summary: '(Admin) Get any payout by id' })
  @ApiResponse({ status: 200, schema: { example: PAYOUT_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Payout not found.' })
  findById(@Param('id') id: string) {
    return this.payouts.findByIdAsAdmin(id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Payout status updated (admin)')
  @ApiOperation({
    summary: '(Admin) Transition a payout\'s status',
    description:
      'Drives the payout state machine. Side effects:\n' +
      '- PENDING → PROCESSING: stamps `processedById` + `processedAt`\n' +
      '- * → PAID: stamps `paidAt` AND auto-completes the parent ' +
      'Transaction (status → COMPLETED, `completedAt` set), atomically\n' +
      '- * → FAILED: stores `failureReason`\n' +
      '- FAILED → PENDING: allowed (retry)\n' +
      '- PAID is terminal — further transitions return 400',
  })
  @ApiResponse({
    status: 200,
    description: 'Status updated.',
    schema: {
      example: {
        ...PAYOUT_EXAMPLE,
        status: 'PROCESSING',
        processedById: 'admin-id',
        processedAt: '2026-05-22T14:35:00.000Z',
        reference: 'BANK-TXN-9988',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid transition for the current status.',
  })
  @ApiResponse({ status: 404, description: 'Payout not found.' })
  updateStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePayoutStatusDto,
  ) {
    return this.payouts.updateStatus(admin.id, id, dto);
  }
}
