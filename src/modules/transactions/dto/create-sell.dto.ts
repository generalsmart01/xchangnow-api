// src/modules/transactions/dto/create-sell.dto.ts

/**
 * Body schema for POST /transactions/sell.
 *
 * `assetNetworkId` is a single FK to the asset × network pair the user is
 * sending crypto on. cryptoAmount is a decimal STRING, not a number — JSON
 * numbers > 2^53 lose precision and crypto amounts can easily exceed that
 * (e.g. `0.005000000000000001`). The service parses with Prisma.Decimal
 * which preserves all 18 decimal places.
 *
 * No fiat amount in the request — that's computed server-side from
 * cryptoAmount × current sellRate. Never trust the client to send the
 * fiat amount; rate manipulation would be catastrophic.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class CreateSellDto {
  @ApiProperty({
    example: 'cmpqe002b0001o81g8k7vmpqr',
    description:
      'FK to asset_networks.id — the asset × network combo the user is sending crypto on. ' +
      'Pair must be enabled and have an active company wallet.',
  })
  @IsString()
  assetNetworkId!: string;

  @ApiProperty({
    example: '0.005',
    description:
      'Amount of crypto the user is selling, as a decimal string. ' +
      'Sent as STRING (not number) to preserve precision beyond 2^53. ' +
      'Up to 18 decimal places.',
    pattern: '^\\d+(\\.\\d{1,18})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,18})?$/, {
    message: 'cryptoAmount must be a decimal number with up to 18 decimals',
  })
  @MaxLength(40)
  cryptoAmount!: string;
}
