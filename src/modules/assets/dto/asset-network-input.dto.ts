// src/modules/assets/dto/asset-network-input.dto.ts

/**
 * Per (asset, network) pair config — used in TWO places:
 *   1. Nested array element inside CreateAssetDto (initial pairs at asset creation)
 *   2. Full body for POST /admin/assets/:assetId/networks (add a pair later)
 *
 * The pair binding (`networkId` here, plus the `:assetId` URL param at use site
 * 2 or the Asset being created at use site 1) is IMMUTABLE once written — to
 * change which networks an asset runs on, DELETE + recreate the pair. The
 * update DTO (UpdateAssetNetworkDto) omits `networkId` for this reason.
 *
 * Decimal-typed fields are strings to preserve precision through JSON
 * (matches the rest of the codebase — see ExchangeRate DTOs).
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class AssetNetworkInputDto {
  @ApiProperty({
    example: 'cmpqd001a0000o81g4kq8jz5x',
    description: 'FK to networks.id. Must reference an existing, enabled network.',
  })
  @IsString()
  networkId!: string;

  @ApiProperty({
    example: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    required: false,
    description:
      'Token contract address. Required for tokens (USDT-ETH, USDC-POLYGON). ' +
      'Null/omitted for native coins (BTC on Bitcoin, ETH on Ethereum).',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contractAddress?: string;

  @ApiProperty({
    example: 6,
    required: false,
    description:
      "Per-network decimals override. Only set if this network's representation " +
      "of the asset uses different decimals than Asset.decimals (rare). " +
      'Leave null to inherit from Asset.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  decimals?: number;

  @ApiProperty({
    example: '0.0005',
    required: false,
    description: 'Minimum deposit amount in the asset\'s unit (decimal string).',
  })
  @IsOptional()
  @IsNumberString()
  minDeposit?: string;

  @ApiProperty({
    example: '0.001',
    required: false,
    description: 'Minimum withdrawal amount in the asset\'s unit (decimal string).',
  })
  @IsOptional()
  @IsNumberString()
  minWithdrawal?: string;

  @ApiProperty({
    example: '0.0005',
    required: false,
    description: 'Flat withdrawal fee in the asset\'s unit (decimal string). Percentage fees not supported yet.',
  })
  @IsOptional()
  @IsNumberString()
  withdrawalFee?: string;

  @ApiProperty({
    example: 12,
    required: false,
    default: 1,
    description: 'On-chain confirmations required before crediting a deposit.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  confirmationsRequired?: number;

  @ApiProperty({ example: true, required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
