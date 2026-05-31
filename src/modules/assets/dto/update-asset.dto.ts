// src/modules/assets/dto/update-asset.dto.ts

/**
 * Body schema for PATCH /admin/assets/:id.
 *
 * Omits `symbol` and `decimals` — both IMMUTABLE post-create. Changing them
 * would corrupt historical transaction interpretation. To "rename" an asset,
 * disable it and create a new one.
 *
 * Network pair management is OUT OF SCOPE for this DTO — use the
 * /admin/assets/:assetId/networks endpoints for that.
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

export class UpdateAssetDto {
  @ApiProperty({ example: 'Solana', required: false, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiProperty({ example: 'https://cryptologos.cc/logos/solana-sol-logo.png', required: false })
  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiProperty({ example: 100, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
