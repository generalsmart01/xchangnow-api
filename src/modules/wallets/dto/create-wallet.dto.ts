// src/modules/wallets/dto/create-wallet.dto.ts

/**
 * Body schema for POST /wallets (admin).
 *
 * `assetNetworkId` is a single FK pointing at an AssetNetwork row (the
 * asset × network pair from /admin/assets[/networks]). One FK guarantees
 * the combination is valid by construction — you can't register a Bitcoin
 * address against Ethereum, for example.
 *
 * Address validation here is intentionally permissive (length 20-120 chars).
 * Per-chain format validation (Bitcoin Bech32, Tron base58, EVM checksum
 * etc.) would require a per-asset library and is best handled by the human
 * admin entering the address — they should be double-checking against their
 * wallet software anyway. A typo in a company wallet is catastrophic
 * whether or not it's "well-formed".
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateWalletDto {
  @ApiProperty({
    example: 'cmpqe002b0001o81g8k7vmpqr',
    description:
      'FK to asset_networks.id — the asset × network pair this address holds. ' +
      'Look up via GET /assets to find valid pair ids.',
  })
  @IsString()
  assetNetworkId!: string;

  @ApiProperty({
    example: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    description:
      'On-chain address that will receive deposits. Validated only for length ' +
      '(20-120 chars); per-chain format validation is up to the admin entering it.',
    minLength: 20,
    maxLength: 120,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(120)
  address!: string;

  @ApiPropertyOptional({
    example: 'Primary BTC hot wallet',
    description: 'Optional human-readable label for the wallet (admin-only field).',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      "If false, the wallet won't be picked by `pickActiveWallet()` for new " +
      'transactions. Use it to retire an address without deleting historical data.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
