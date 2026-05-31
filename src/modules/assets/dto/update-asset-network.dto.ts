// src/modules/assets/dto/update-asset-network.dto.ts

/**
 * Body schema for PATCH /admin/asset-networks/:id.
 *
 * Omits `networkId` — the (asset, network) binding is IMMUTABLE post-create.
 * To move an asset to a different network, DELETE this pair and POST a new one.
 *
 * Mirrors AssetNetworkInputDto field-for-field minus `networkId`, all optional.
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

export class UpdateAssetNetworkDto {
  @ApiProperty({ example: '0xdAC17F958D2ee523a2206206994597C13D831ec7', required: false, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contractAddress?: string;

  @ApiProperty({ example: 6, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  decimals?: number;

  @ApiProperty({ example: '0.0005', required: false })
  @IsOptional()
  @IsNumberString()
  minDeposit?: string;

  @ApiProperty({ example: '0.001', required: false })
  @IsOptional()
  @IsNumberString()
  minWithdrawal?: string;

  @ApiProperty({ example: '0.0005', required: false })
  @IsOptional()
  @IsNumberString()
  withdrawalFee?: string;

  @ApiProperty({ example: 12, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  confirmationsRequired?: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
