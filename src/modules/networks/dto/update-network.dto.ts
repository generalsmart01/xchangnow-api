// src/modules/networks/dto/update-network.dto.ts

/**
 * Body schema for PATCH /admin/networks/:id.
 *
 * Omits `code` deliberately — that field is immutable post-create (changing
 * it would break transaction audit history + explorer deep-links). Use
 * DELETE + recreate if you really need to rename a network, BEFORE any
 * transactions reference it.
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateNetworkDto {
  @ApiProperty({ example: 'Solana Mainnet', required: false, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiProperty({ example: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  chainId?: number;

  @ApiProperty({ example: 'https://solscan.io/tx/{txHash}', required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  explorerUrlTemplate?: string;

  @ApiProperty({ example: 'SOL', required: false, maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  nativeAssetSymbol?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiProperty({ example: 10, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
