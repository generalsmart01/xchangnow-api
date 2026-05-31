// src/modules/transactions/dto/create-swap.dto.ts

/**
 * Body schema for POST /transactions/swap.
 *
 * Carries BOTH sides as AssetNetwork pair ids: what the user is sending
 * (`fromAssetNetworkId`, `fromAmount`) and what they want to receive
 * (`toAssetNetworkId`, `toAddress`). The service computes `toAmount`
 * server-side from the cross-rate; the user only states the FROM amount.
 *
 * Validation rules enforced server-side:
 *   - `fromAssetNetworkId !== toAssetNetworkId` (degenerate same-pair swap)
 *   - The two pairs must reference DIFFERENT assets — bridging the same
 *     asset across networks (e.g. USDT-ETH ↔ USDT-TRON) is REJECTED for
 *     now. It's a legitimate user need but requires a real bridge
 *     integration; tackled as a separate feature.
 *
 * toAddress validation here is length-only (20-120 chars). Per-chain
 * address format validation is intentionally deferred — would need a
 * chain-specific library per asset and isn't worth blocking submissions on.
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSwapDto {
  @ApiProperty({
    example: 'cmpqe002b0001o81g8k7vmpqr',
    description:
      'FK to asset_networks.id — the FROM-side asset × network pair the user is sending.',
  })
  @IsString()
  fromAssetNetworkId!: string;

  @ApiProperty({
    example: '0.005',
    description: 'Amount of FROM asset. Decimal string, up to 18 decimals.',
    pattern: '^\\d+(\\.\\d{1,18})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,18})?$/, {
    message: 'fromAmount must be a decimal number with up to 18 decimals',
  })
  @MaxLength(40)
  fromAmount!: string;

  @ApiProperty({
    example: 'cmpqe003c0002o81g4abcdef',
    description:
      'FK to asset_networks.id — the TO-side pair the user wants to receive. ' +
      'Must reference a DIFFERENT asset than fromAssetNetworkId (no same-asset cross-network ' +
      'bridging in this version — 400 if same asset).',
  })
  @IsString()
  toAssetNetworkId!: string;

  @ApiProperty({
    example: 'TJYeasTPa6gpEEfYYhfA3HzfwPV82dB9Vt',
    description:
      "User's wallet address that will receive the TO asset after admin " +
      'approves the swap and marks it completed. Length-validated only (20-120 chars).',
    minLength: 20,
    maxLength: 120,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(120)
  toAddress!: string;
}
