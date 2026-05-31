// src/modules/assets/dto/create-asset.dto.ts

/**
 * Body schema for POST /admin/assets.
 *
 * Two write paths:
 *  - Create asset only: omit `networks` or pass empty array. Add pairs later
 *    via POST /admin/assets/:assetId/networks.
 *  - Create asset + initial pairs: pass `networks` array. Asset + N
 *    AssetNetwork rows are created in one transaction (all or nothing).
 *
 * `symbol` and `decimals` are IMMUTABLE post-create — changing decimals later
 * would corrupt every historical transaction's interpretation, and changing
 * symbol would break explorer links + admin UI. Enforced by omitting them
 * from UpdateAssetDto.
 */

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AssetNetworkInputDto } from './asset-network-input.dto';

export class CreateAssetDto {
  @ApiProperty({
    example: 'SOL',
    description: 'Uppercase ticker. IMMUTABLE post-create. 2-10 chars, letters/digits only.',
    minLength: 2,
    maxLength: 10,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  @Matches(/^[A-Z][A-Z0-9]*$/, {
    message: 'symbol must be UPPERCASE letters and digits, starting with a letter',
  })
  symbol!: string;

  @ApiProperty({ example: 'Solana', maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    example: 9,
    description:
      'Canonical decimals for this asset (8 for BTC, 18 for ETH, 6 for USDT, 9 for SOL). ' +
      'IMMUTABLE post-create — changing it would corrupt historical amounts.',
    minimum: 0,
    maximum: 18,
  })
  @IsInt()
  @Min(0)
  @Max(18)
  decimals!: number;

  @ApiProperty({
    example: 'https://cryptologos.cc/logos/solana-sol-logo.png',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @ApiProperty({ example: true, required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiProperty({ example: 100, required: false, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({
    type: [AssetNetworkInputDto],
    required: false,
    description:
      'Optional initial AssetNetwork pairs. Each must reference an existing, ' +
      'enabled network. Created atomically with the asset (all-or-nothing). ' +
      'You can also add pairs later via POST /admin/assets/:assetId/networks.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssetNetworkInputDto)
  networks?: AssetNetworkInputDto[];
}
