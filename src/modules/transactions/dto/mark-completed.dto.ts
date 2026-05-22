import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class MarkCompletedDto {
  @ApiPropertyOptional({
    example:
      'outbound-usdt-9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e1234567890abcdef',
    description:
      'On-chain tx hash for the crypto WE sent to the user. ' +
      'REQUIRED for BUY and SWAP (returns 400 if missing). ' +
      'Not used for SELL — SELL completes via payout PAID, not this endpoint. ' +
      'Stored as a TransactionProof row with type=OTHER.',
    minLength: 10,
    maxLength: 200,
  })
  // Required for BUY/SWAP (admin sent crypto to user; record the on-chain hash).
  // Service rejects SELL transactions hitting this endpoint, so it isn't needed there.
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  outboundTxHash?: string;

  @ApiPropertyOptional({
    example: 'Sent via Tron hot wallet at 14:25 GMT',
    description: 'Optional notes appended to the TransactionProof row.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
