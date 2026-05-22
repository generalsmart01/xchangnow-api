import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProofType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UploadProofDto {
  @ApiProperty({
    enum: ProofType,
    example: ProofType.CRYPTO_TX_HASH,
    description:
      'Must match the transaction type:\n' +
      '- SELL → CRYPTO_TX_HASH (on-chain hash the user sent)\n' +
      '- SWAP → CRYPTO_TX_HASH (on-chain hash the user sent for the FROM side)\n' +
      '- BUY  → BANK_TRANSFER_RECEIPT (URL of the receipt image)',
  })
  @IsEnum(ProofType)
  type!: ProofType;

  @ApiProperty({
    example:
      'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
    description:
      'For CRYPTO_TX_HASH: the on-chain tx hash (string). ' +
      'For BANK_TRANSFER_RECEIPT: an HTTPS URL of the receipt image. ' +
      'Length: 10-500 chars. SELL/SWAP hashes are mirrored to ' +
      '`transaction.txHash` (unique system-wide — submitting a hash that ' +
      'already exists returns 409).',
    minLength: 10,
    maxLength: 500,
  })
  // URL of bank receipt OR on-chain tx hash, depending on type.
  // Service validates the value matches the type semantically.
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  value!: string;

  @ApiPropertyOptional({
    example: 'Sent at 02:30 GMT, took 3 confirmations',
    description: 'Optional free-text notes visible to the verifying admin.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
