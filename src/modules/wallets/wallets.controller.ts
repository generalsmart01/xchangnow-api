// src/modules/wallets/wallets.controller.ts

/**
 * ─── Endpoints (ALL admin: ADMIN | SUPER_ADMIN) ─────────────────────────────
 *
 *   POST   /wallets              body: CreateWalletDto (assetNetworkId + address)
 *                                201: WalletAddress (with assetNetwork embedded)
 *                                400: assetNetworkId missing or disabled
 *                                409: duplicate (assetNetwork + address)
 *
 *   GET    /wallets              query: assetNetworkId/assetId/networkId/isActive
 *                                200: WalletAddress[] (with assetNetwork embedded)
 *
 *   GET    /wallets/:id          single wallet
 *
 *   PATCH  /wallets/:id          body: UpdateWalletDto (label + isActive only;
 *                                address is immutable — would orphan history)
 *
 *   DELETE /wallets/:id          soft delete (sets isActive=false; row stays
 *                                so historical transactions retain their ref)
 *
 * Controller-level @Roles(ADMIN, SUPER_ADMIN) — no public routes.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { ListWalletsQueryDto } from './dto/list-wallets-query.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { WalletsService } from './wallets.service';

const WALLET_EXAMPLE = {
  id: 'cmpgx5rxg000eo85k60xgd3fr',
  assetNetworkId: 'cmpqe002b0001o81g8k7vmpqr',
  address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  label: 'Primary BTC hot wallet',
  isActive: true,
  createdAt: '2026-05-22T12:00:00.000Z',
  updatedAt: '2026-05-22T12:00:00.000Z',
  assetNetwork: {
    id: 'cmpqe002b0001o81g8k7vmpqr',
    asset: { id: 'cmpqd99zz0000o81g4kq8jz5x', symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
    network: { id: 'cmpqd001a0000o81g4kq8jz5x', code: 'BITCOIN', name: 'Bitcoin', chainId: null },
  },
};

@ApiTags('Wallets (admin)')
@ApiBearerAuth('JWT-auth')
@Controller('wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN) // controller-level → applies to every route
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @LogMessage('Wallet created (admin)')
  @ApiOperation({
    summary: '(Admin) Create a company wallet address',
    description:
      'Registers a wallet that the system will use to receive crypto from ' +
      'users (SELL flow) and to send crypto to users (BUY/SWAP). ' +
      'Reference the asset-network pair via `assetNetworkId` (look it up via ' +
      'GET /assets — each asset has a `networks` array with pair ids). ' +
      '(assetNetworkId, address) must be unique.',
  })
  @ApiResponse({
    status: 201,
    description: 'Wallet created.',
    schema: { example: WALLET_EXAMPLE },
  })
  @ApiResponse({
    status: 400,
    description: 'assetNetworkId does not exist or is disabled.',
  })
  @ApiResponse({
    status: 409,
    description: 'Wallet (assetNetwork + address) already exists.',
  })
  create(@Body() dto: CreateWalletDto) {
    return this.wallets.create(dto);
  }

  @Get()
  @LogMessage('Listed wallets (admin)')
  @ApiOperation({
    summary: '(Admin) List wallets',
    description:
      'Lists all wallets, filterable by assetNetworkId, assetId, networkId, isActive. ' +
      'Each wallet response includes the embedded assetNetwork with asset + network details. ' +
      'Active wallets are sorted first, then by most-recently-created.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of wallets.',
    schema: { example: [WALLET_EXAMPLE] },
  })
  list(@Query() query: ListWalletsQueryDto) {
    return this.wallets.list(query);
  }

  @Get(':id')
  @LogMessage('Fetched wallet (admin)')
  @ApiOperation({ summary: '(Admin) Get a wallet by id' })
  @ApiResponse({ status: 200, schema: { example: WALLET_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  get(@Param('id') id: string) {
    return this.wallets.findById(id);
  }

  @Patch(':id')
  @LogMessage('Wallet updated (admin)')
  @ApiOperation({
    summary: '(Admin) Update a wallet\'s label or active state',
    description:
      'Only `label` and `isActive` are mutable. To change the address itself, ' +
      'delete and recreate (changing addresses on existing wallets would orphan ' +
      'historical transactions).',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated wallet.',
    schema: { example: { ...WALLET_EXAMPLE, label: 'BTC retired', isActive: false } },
  })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  update(@Param('id') id: string, @Body() dto: UpdateWalletDto) {
    return this.wallets.update(id, dto);
  }

  @Delete(':id')
  @LogMessage('Wallet deactivated (admin)')
  @ApiOperation({
    summary: '(Admin) Deactivate a wallet (soft delete)',
    description:
      'Sets `isActive=false`. The wallet remains in the DB so historical ' +
      'transactions keep their reference. To restore, PATCH `isActive=true`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Wallet deactivated.',
    schema: { example: { ...WALLET_EXAMPLE, isActive: false } },
  })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  deactivate(@Param('id') id: string) {
    return this.wallets.deactivate(id);
  }
}
