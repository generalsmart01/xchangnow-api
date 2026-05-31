// src/modules/networks/dto/create-network.dto.ts

/**
 * Body schema for POST /admin/networks.
 *
 * `code` is the immutable stable identifier — once a transaction references
 * this network, the code MUST NOT change (it'd break audit + explorer
 * deep-links). Validate strict uppercase + dash-free at the boundary.
 *
 * Display fields (name, explorerUrlTemplate, nativeAssetSymbol, sortOrder,
 * isEnabled) are all mutable post-create via PATCH.
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateNetworkDto {
  @ApiProperty({
    example: 'SOLANA',
    description:
      'Stable identifier. Uppercase A-Z + underscores only (e.g. ETHEREUM, BSC, ARBITRUM_ONE). ' +
      'IMMUTABLE after first transaction references this network.',
    minLength: 2,
    maxLength: 20,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'code must be UPPERCASE letters, digits, and underscores; starting with a letter',
  })
  code!: string;

  @ApiProperty({ example: 'Solana', maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    example: 1,
    required: false,
    description: 'EVM chain id. Set for Ethereum-compatible chains; omit for non-EVM (BTC, Solana, Tron).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  chainId?: number;

  @ApiProperty({
    example: 'https://etherscan.io/tx/{txHash}',
    required: false,
    description: 'URL template with `{txHash}` placeholder. Used by the frontend to deep-link transaction proofs.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  explorerUrlTemplate?: string;

  @ApiProperty({
    example: 'SOL',
    required: false,
    description: 'Display-only symbol of the chain\'s native asset. NOT a FK to assets — this is just label text.',
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  nativeAssetSymbol?: string;

  @ApiProperty({ example: true, default: true, required: false })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiProperty({
    example: 10,
    required: false,
    description: 'Lower numbers sort first in UI pickers. Defaults to 0.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
