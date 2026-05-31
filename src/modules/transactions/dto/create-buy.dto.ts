// src/modules/transactions/dto/create-buy.dto.ts

/**
 * Body schema for POST /transactions/buy.
 *
 * The client sends `fiatAmount` (what they want to spend in NGN) plus the
 * `assetNetworkId` (the asset × network pair they want to receive crypto
 * on); the server computes the crypto amount they'll receive using the
 * current buyRate. Never trust the client to send the computed side.
 *
 * fiatAmount is a STRING with up to 2 decimal places (NGN cents) for the
 * same precision reasons as SELL's cryptoAmount.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class CreateBuyDto {
  @ApiProperty({
    example: 'cmpqe002b0001o81g8k7vmpqr',
    description:
      'FK to asset_networks.id — the asset × network combo the user wants to receive on. ' +
      'Pair must be enabled. Look up via GET /assets.',
  })
  @IsString()
  assetNetworkId!: string;

  @ApiProperty({
    example: '30000.00',
    description:
      'NGN amount the user will pay. Decimal string, up to 2 places. ' +
      'The crypto amount the user receives is computed server-side using ' +
      'the current buyRate from RatesModule.',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'fiatAmount must be a number with up to 2 decimal places',
  })
  @MaxLength(20)
  fiatAmount!: string;
}
