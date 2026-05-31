// src/modules/wallets/dto/list-wallets-query.dto.ts

/**
 * Query schema for GET /wallets (admin).
 *
 * No pagination — there are at most a handful of company wallets. Filters
 * are mostly for the admin UI:
 *   - `assetNetworkId`  exact pair (e.g. "show me all USDT-TRON wallets")
 *   - `assetId`         all wallets for one asset across networks
 *   - `networkId`       all wallets on one network across assets
 *   - `isActive`        active vs retired
 *
 * `isActive` uses @Transform to coerce the string query param ('true' /
 * 'false') into a real boolean, since URL query params are always strings.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ListWalletsQueryDto {
  @ApiPropertyOptional({
    example: 'cmpqe002b0001o81g8k7vmpqr',
    description: 'Filter by exact asset-network pair id.',
  })
  @IsOptional()
  @IsString()
  assetNetworkId?: string;

  @ApiPropertyOptional({
    example: 'cmpqd99zz0000o81g4kq8jz5x',
    description: 'Filter by assetId — returns wallets for this asset across all its networks.',
  })
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional({
    example: 'cmpqd001a0000o81g4kq8jz5x',
    description: 'Filter by networkId — returns all assets on this network.',
  })
  @IsOptional()
  @IsString()
  networkId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter active vs retired. Pass literal `true` or `false`.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
