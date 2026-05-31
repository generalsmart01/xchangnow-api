// src/modules/transactions/dto/approve-transaction.dto.ts

/**
 * Body schema for POST /transactions/:id/approve (admin).
 *
 * Body is essentially empty — `notes` is optional and only used for the
 * audit log. The actual approval decision is "yes, this proof checked out"
 * and doesn't need fields beyond the implicit admin identity.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveTransactionDto {
  @ApiPropertyOptional({
    example: 'Tx hash verified on Blockstream',
    description: 'Optional admin notes captured in the audit log.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
