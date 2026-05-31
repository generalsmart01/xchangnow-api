// src/modules/transactions/dto/reject-transaction.dto.ts

/**
 * Body schema for POST /transactions/:id/reject (admin).
 *
 * Reason is REQUIRED (5-500 chars). Surfaced back to the user on their
 * transaction detail screen and recorded in user_activity_logs. Forcing
 * a real reason — not just a boolean reject — gives the user something
 * actionable ("re-upload the receipt", "wrong account number", etc.).
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectTransactionDto {
  @ApiProperty({
    example: 'Receipt unreadable; please re-submit',
    description:
      'Mandatory human-readable rejection reason. Surfaced to the user and ' +
      'recorded in user_activity_logs.',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
