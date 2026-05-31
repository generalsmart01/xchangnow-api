// src/modules/networks/networks.controller.ts

/**
 * ─── Endpoints ──────────────────────────────────────────────────────────────
 *
 *   GET    /networks                  any authenticated user
 *                                     200: enabled networks (cached 60s)
 *
 *  --- Admin (ADMIN | SUPER_ADMIN) ---
 *
 *   GET    /admin/networks            paginated, includes disabled
 *   POST   /admin/networks            body: CreateNetworkDto, 201: Network
 *                                     409: code collision
 *   GET    /admin/networks/:id        200: Network, 404 if not found
 *   PATCH  /admin/networks/:id        body: UpdateNetworkDto (code is immutable)
 *                                     200: updated Network
 *   PATCH  /admin/networks/:id/enabled    body: { enabled: boolean }
 *                                         convenience toggle for the disable switch
 *   DELETE /admin/networks/:id        204
 *                                     409: network has attached assets — disable instead
 *
 * Reads are cached in-process (60s TTL); cache is invalidated on every
 * admin write (create/update/setEnabled/delete) within the same Nest
 * instance. Cross-instance invalidation arrives when we add Redis.
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
import { CreateNetworkDto } from './dto/create-network.dto';
import { UpdateNetworkDto } from './dto/update-network.dto';
import { NetworksService } from './networks.service';

const NETWORK_EXAMPLE = {
  id: 'cmpqd001a0000o81g4kq8jz5x',
  code: 'ETHEREUM',
  name: 'Ethereum',
  chainId: 1,
  explorerUrlTemplate: 'https://etherscan.io/tx/{txHash}',
  nativeAssetSymbol: 'ETH',
  isEnabled: true,
  sortOrder: 10,
  createdAt: '2026-05-30T11:00:00.000Z',
  updatedAt: '2026-05-30T11:00:00.000Z',
};

@ApiTags('Networks')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class NetworksController {
  constructor(private readonly networks: NetworksService) {}

  // ----------------------------- public read -----------------------------

  @Get('networks')
  @LogMessage('Listed enabled networks')
  @ApiOperation({
    summary: 'List enabled networks (for coin/network pickers)',
    description:
      'Returns all enabled networks sorted by `sortOrder` then `name`. ' +
      'Frontend coin pickers use this to render network options once the user picks an asset. ' +
      'Cached in-process 60s, invalidated on any admin write.',
  })
  @ApiResponse({ status: 200, schema: { example: [NETWORK_EXAMPLE] } })
  listEnabled() {
    return this.networks.listEnabled();
  }

  // -------------------------------- admin --------------------------------

  @Get('admin/networks')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Listed all networks (admin)')
  @ApiOperation({
    summary: '(Admin) List ALL networks (including disabled)',
    description: 'Paginated. Includes disabled networks. Use page + pageSize query params.',
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: { networks: [NETWORK_EXAMPLE], total: 5, page: 1, pageSize: 50 },
    },
  })
  listAll(@Query() query: { page?: number; pageSize?: number }) {
    return this.networks.listAll(query);
  }

  @Post('admin/networks')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Network created (admin)')
  @ApiOperation({
    summary: '(Admin) Create a new network',
    description:
      'Adds a new blockchain to the system. After creation, attach assets ' +
      'to it via POST /admin/assets/:assetId/networks. ' +
      '`code` is IMMUTABLE post-create — pick carefully.',
  })
  @ApiBody({ type: CreateNetworkDto })
  @ApiResponse({ status: 201, schema: { example: NETWORK_EXAMPLE } })
  @ApiResponse({ status: 409, description: 'A network with this code already exists.' })
  create(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreateNetworkDto) {
    return this.networks.create(admin.id, dto);
  }

  @Get('admin/networks/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Fetched network (admin)')
  @ApiOperation({ summary: '(Admin) Get a network by id' })
  @ApiResponse({ status: 200, schema: { example: NETWORK_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Network not found.' })
  findById(@Param('id') id: string) {
    return this.networks.findById(id);
  }

  @Patch('admin/networks/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Network updated (admin)')
  @ApiOperation({
    summary: '(Admin) Update a network',
    description:
      'Updates display fields (name, chainId, explorerUrlTemplate, nativeAssetSymbol, ' +
      'isEnabled, sortOrder). `code` is IMMUTABLE — if you need to rename, ' +
      'DELETE + recreate BEFORE any transactions reference this network.',
  })
  @ApiBody({ type: UpdateNetworkDto })
  @ApiResponse({ status: 200, schema: { example: NETWORK_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'Network not found.' })
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateNetworkDto,
  ) {
    return this.networks.update(admin.id, id, dto);
  }

  @Patch('admin/networks/:id/enabled')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Network enabled toggled (admin)')
  @ApiOperation({
    summary: '(Admin) Toggle a network on/off',
    description:
      'Convenience for the disable switch — equivalent to PATCH with { isEnabled }. ' +
      'Disabling a network does NOT affect existing transactions; it only hides it ' +
      'from new coin pickers.',
  })
  @ApiBody({ schema: { example: { enabled: false } } })
  @ApiResponse({ status: 200, schema: { example: { ...NETWORK_EXAMPLE, isEnabled: false } } })
  setEnabled(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.networks.setEnabled(admin.id, id, body.enabled);
  }

  @Delete('admin/networks/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Network deleted (admin)')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '(Admin) Delete a network',
    description:
      'Hard delete. Fails with 409 if any AssetNetwork rows still reference it ' +
      "(asset-network pairs must be removed first, or you can just `isEnabled=false`).",
  })
  @ApiResponse({ status: 204, description: 'Network deleted.' })
  @ApiResponse({ status: 404, description: 'Network not found.' })
  @ApiResponse({ status: 409, description: 'Network is still referenced by asset-network pairs.' })
  delete(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) {
    return this.networks.delete(admin.id, id);
  }
}
