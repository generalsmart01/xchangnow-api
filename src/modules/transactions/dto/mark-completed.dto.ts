import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class MarkCompletedDto {
  // Required for BUY/SWAP (admin sent crypto to user; record the on-chain hash).
  // Service rejects SELL transactions hitting this endpoint, so it isn't needed there.
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  outboundTxHash?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
