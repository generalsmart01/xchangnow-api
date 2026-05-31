// src/modules/rates/dto/create-rate.dto.ts

/**
 * Body schema for POST /rates (admin).
 *
 * Creates a new time-series rate snapshot for an Asset (NOT for an
 * AssetNetwork — rates are per-asset, see ExchangeRate model comment). The
 * supplied `assetId` must reference an existing, enabled asset; service
 * validates this before insert.
 *
 * `buyRate` and `sellRate` are separate fields — the spread between them is
 * our platform's fee on BUY/SELL operations. `sellRate < buyRate` by
 * convention (we buy crypto from users cheaper than we sell to them), but
 * the schema doesn't enforce — admin can set whatever they want (e.g.
 * promotional inverted spread).
 *
 * Decimal strings, not numbers — same precision-preservation reason as
 * transaction amounts.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRateDto {
  @ApiProperty({
    example: 'cmpqd99zz0000o81g4kq8jz5x',
    description:
      'FK to assets.id — the asset this rate covers. Look up via GET /assets to find the id ' +
      'for a given symbol (e.g. "BTC" → cuid).',
  })
  @IsString()
  assetId!: string;

  @ApiProperty({
    example: '60000000.00',
    description:
      'Rate at which WE sell this asset to users (fiat per 1 unit of crypto). ' +
      'Used to price BUY transactions. Decimal string, up to 2 places.',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'buyRate must be a decimal number with up to 2 decimal places',
  })
  @MaxLength(20)
  buyRate!: string;

  @ApiProperty({
    example: '58000000.00',
    description:
      'Rate at which WE buy this asset from users (fiat per 1 unit). ' +
      'Used to price SELL transactions. Should be < buyRate (spread is our fee).',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'sellRate must be a decimal number with up to 2 decimal places',
  })
  @MaxLength(20)
  sellRate!: string;

  @ApiPropertyOptional({
    example: 'NGN',
    description: 'Fiat currency. Defaults to NGN.',
    default: 'NGN',
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  fiatCurrency?: string;

  @ApiPropertyOptional({
    example: 'manual',
    description:
      'Where this rate came from: "manual" (admin entry), "coingecko", "binance", etc. ' +
      'Defaults to "manual". `isManualOverride` on the stored row is auto-set true ' +
      'when source is "manual" or omitted.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}
