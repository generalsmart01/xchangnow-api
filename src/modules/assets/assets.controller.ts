// src/modules/assets/assets.controller.ts

/**
 * ─── Endpoints ──────────────────────────────────────────────────────────────
 *
 *   GET    /assets                          any authenticated user
 *                                           200: enabled assets w/ enabled networks (cached 60s)
 *   GET    /assets/:idOrSymbol              200: asset + networks; 404 not found
 *
 *  --- Admin (ADMIN | SUPER_ADMIN) ---
 *
 *   GET    /admin/assets                    paginated all (incl. disabled)
 *   POST   /admin/assets                    body: CreateAssetDto (with optional networks[])
 *                                           201: Asset (+ created pairs)
 *                                           409: symbol collision
 *                                           400: bad networkId(s)
 *   GET    /admin/assets/:id                200: Asset + all pairs (incl. disabled)
 *   PATCH  /admin/assets/:id                body: UpdateAssetDto (symbol/decimals immutable)
 *   PATCH  /admin/assets/:id/enabled        body: { enabled: boolean } convenience toggle
 *   DELETE /admin/assets/:id                204; 409 if pairs/transactions exist
 *
 *   POST   /admin/assets/:assetId/networks  add an AssetNetwork pair to an existing asset
 *                                           body: AssetNetworkInputDto
 *                                           201: AssetNetwork pair
 *                                           409: pair already exists for this asset+network
 *
 *   PATCH  /admin/asset-networks/:id        update pair config (networkId immutable)
 *   DELETE /admin/asset-networks/:id        204; 409 if referenced by transactions
 *
 * Public reads cached 60s in-process; cache invalidated on every admin write.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
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
import { AssetsService } from './assets.service';
import { AssetNetworkInputDto } from './dto/asset-network-input.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UpdateAssetNetworkDto } from './dto/update-asset-network.dto';

const NETWORK_EMBED_EXAMPLE = {
  id: 'cmpqd001a0000o81g4kq8jz5x',
  code: 'ETHEREUM',
  name: 'Ethereum',
  chainId: 1,
};

const ASSET_NETWORK_EXAMPLE = {
  id: 'cmpqe002b0001o81g8k7vmpqr',
  assetId: 'cmpqd99zz0000o81g4kq8jz5x',
  networkId: 'cmpqd001a0000o81g4kq8jz5x',
  contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  decimals: null,
  minDeposit: '0.0005',
  minWithdrawal: '0.001',
  withdrawalFee: '0.0005',
  confirmationsRequired: 12,
  isEnabled: true,
  network: NETWORK_EMBED_EXAMPLE,
  createdAt: '2026-05-30T11:00:00.000Z',
  updatedAt: '2026-05-30T11:00:00.000Z',
};

const ASSET_EXAMPLE = {
  id: 'cmpqd99zz0000o81g4kq8jz5x',
  symbol: 'USDT',
  name: 'Tether USD',
  decimals: 6,
  iconUrl: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  isEnabled: true,
  sortOrder: 30,
  networks: [ASSET_NETWORK_EXAMPLE],
  createdAt: '2026-05-30T11:00:00.000Z',
  updatedAt: '2026-05-30T11:00:00.000Z',
};

@ApiTags('Assets')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  // ----------------------------- public read -----------------------------

  @Get('assets')
  @LogMessage('Listed enabled assets')
  @ApiOperation({
    summary: 'List enabled assets with their enabled networks',
    description:
      'Returns enabled assets (sorted by sortOrder, symbol) with their enabled ' +
      'AssetNetwork pairs eagerly loaded. Frontend uses this to populate coin/network ' +
      'pickers. Cached in-process for 60s.',
  })
  @ApiResponse({ status: 200, schema: { example: [ASSET_EXAMPLE] } })
  listEnabled() {
    return this.assets.listEnabled();
  }

  @Get('assets/:idOrSymbol')
  @LogMessage('Fetched asset')
  @ApiOperation({
    summary: 'Get an asset by id or symbol',
    description:
      'Pass either the cuid id (`cmp...`) or the uppercase symbol (`USDT`). ' +
      'Returns the asset with ALL its AssetNetwork pairs (incl. disabled) so ' +
      'the UI can render the full chain list.',
  })
  @ApiResponse({ status: 200, schema: { example: ASSET_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  findByIdOrSymbol(@Param('idOrSymbol') idOrSymbol: string) {
    return /^[A-Z0-9]+$/.test(idOrSymbol)
      ? this.assets.findBySymbol(idOrSymbol)
      : this.assets.findById(idOrSymbol);
  }

  // -------------------------------- admin --------------------------------

  @Get('admin/assets')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Listed all assets (admin)')
  @ApiOperation({ summary: '(Admin) List ALL assets (including disabled)' })
  @ApiResponse({
    status: 200,
    schema: { example: { assets: [ASSET_EXAMPLE], total: 4, page: 1, pageSize: 50 } },
  })
  listAll(@Query() query: { page?: number; pageSize?: number }) {
    return this.assets.listAll(query);
  }

  @Post('admin/assets')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Asset created (admin)')
  @ApiOperation({
    summary: '(Admin) Create a new asset',
    description:
      'Creates an Asset, optionally with initial AssetNetwork pairs in one ' +
      'transaction. To attach networks later instead, omit `networks` and use ' +
      'POST /admin/assets/:assetId/networks per pair.\n\n' +
      '**Immutability after create:** `symbol` and `decimals` cannot be changed ' +
      '(would corrupt historical transaction interpretation).',
  })
  @ApiBody({ type: CreateAssetDto })
  @ApiResponse({ status: 201, schema: { example: ASSET_EXAMPLE } })
  @ApiResponse({ status: 400, description: 'Bad networkId or duplicate networks in array.' })
  @ApiResponse({ status: 409, description: 'Symbol already in use.' })
  create(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreateAssetDto) {
    return this.assets.create(admin.id, dto);
  }

  @Get('admin/assets/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Fetched asset (admin)')
  @ApiOperation({ summary: '(Admin) Get asset by id with all pairs' })
  @ApiResponse({ status: 200, schema: { example: ASSET_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  findById(@Param('id') id: string) {
    return this.assets.findById(id);
  }

  @Patch('admin/assets/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Asset updated (admin)')
  @ApiOperation({
    summary: '(Admin) Update an asset',
    description:
      'Updates mutable fields only (name, iconUrl, isEnabled, sortOrder). ' +
      '`symbol` and `decimals` are IMMUTABLE post-create.',
  })
  @ApiBody({ type: UpdateAssetDto })
  @ApiResponse({ status: 200, schema: { example: ASSET_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assets.update(admin.id, id, dto);
  }

  @Patch('admin/assets/:id/enabled')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Asset enabled toggled (admin)')
  @ApiOperation({
    summary: '(Admin) Toggle an asset on/off',
    description: 'Equivalent to PATCH with { isEnabled }. Existing transactions are unaffected.',
  })
  @ApiBody({ schema: { example: { enabled: false } } })
  @ApiResponse({ status: 200, schema: { example: { ...ASSET_EXAMPLE, isEnabled: false } } })
  setEnabled(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.assets.setEnabled(admin.id, id, body.enabled);
  }

  @Delete('admin/assets/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Asset deleted (admin)')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '(Admin) Delete an asset',
    description:
      'Hard delete. Fails with 409 if AssetNetwork pairs or transactions reference it. ' +
      'Disable instead (PATCH /admin/assets/:id/enabled with { enabled: false }) to ' +
      'remove from new flows while preserving history.',
  })
  @ApiResponse({ status: 204, description: 'Asset deleted.' })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  @ApiResponse({ status: 409, description: 'Asset is still referenced.' })
  delete(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) {
    return this.assets.delete(admin.id, id);
  }

  // ------------------------ per-asset pair routes ------------------------

  @Post('admin/assets/:assetId/networks')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('AssetNetwork pair created (admin)')
  @ApiOperation({
    summary: '(Admin) Add a network pair to an existing asset',
    description:
      'Attaches the asset to another network with its per-pair config (contract address, ' +
      'min deposit/withdrawal, fee, confirmations). The (asset, network) combination must ' +
      'not already exist (409 if it does — update the existing pair instead).',
  })
  @ApiBody({ type: AssetNetworkInputDto })
  @ApiResponse({ status: 201, schema: { example: ASSET_NETWORK_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Asset not found.' })
  @ApiResponse({ status: 409, description: 'Asset already has a pair for this network.' })
  addNetwork(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('assetId') assetId: string,
    @Body() dto: AssetNetworkInputDto,
  ) {
    return this.assets.addNetwork(admin.id, assetId, dto);
  }

  @Patch('admin/asset-networks/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('AssetNetwork pair updated (admin)')
  @ApiOperation({
    summary: '(Admin) Update an asset-network pair config',
    description:
      'Updates per-pair fields (contractAddress, decimals override, min deposit/withdrawal, ' +
      'fee, confirmations, isEnabled). The (asset, network) binding is IMMUTABLE — ' +
      'to move to a different network, delete and recreate.',
  })
  @ApiBody({ type: UpdateAssetNetworkDto })
  @ApiResponse({ status: 200, schema: { example: ASSET_NETWORK_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Pair not found.' })
  updatePair(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAssetNetworkDto,
  ) {
    return this.assets.updatePair(admin.id, id, dto);
  }

  @Delete('admin/asset-networks/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('AssetNetwork pair deleted (admin)')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '(Admin) Delete an asset-network pair',
    description: 'Hard delete. Fails 409 if transactions or wallet addresses reference it.',
  })
  @ApiResponse({ status: 204, description: 'Pair deleted.' })
  @ApiResponse({ status: 404, description: 'Pair not found.' })
  @ApiResponse({ status: 409, description: 'Pair is still referenced.' })
  removePair(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) {
    return this.assets.removePair(admin.id, id);
  }
}
