// src/modules/transactions/dto/upload-proof.dto.ts

/**
 * Body schema for POST /transactions/me/:id/proof.
 *
 * `type` must MATCH the transaction type — enforced server-side. A SELL
 * with a BANK_TRANSFER_RECEIPT proof would be nonsensical and is rejected
 * with 400 before any DB write.
 *
 * `value` is overloaded: for CRYPTO_TX_HASH it's the on-chain hash string,
 * for BANK_TRANSFER_RECEIPT it's an HTTPS URL of the receipt image. The
 * shape is the same; downstream consumers know which based on `type`.
 * Length validation is permissive (10-500 chars) to accommodate both.
 *
 * For SELL/SWAP, the value is also mirrored to `transaction.txHash` —
 * which has a system-wide @unique constraint, so the same on-chain hash
 * cannot be claimed twice (anti-replay). Duplicate → 409.
 */

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
