// src/modules/bank-accounts/dto/update-bank-account.dto.ts

/**
 * Body schema for PATCH /bank-accounts/me/:id.
 *
 * Mirrors CreateBankAccountDto but every field is optional — only the
 * specified fields are written. Setting `isDefault=true` atomically
 * unsets the previous default in the same transaction (matches the create
 * behavior).
 *
 * Kept as an explicit class rather than `PartialType(CreateBankAccountDto)`
 * to avoid the @nestjs/mapped-types dep and to keep the validation rules
 * fully visible in this file (no inheritance to chase).
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateBankAccountDto {
  @ApiPropertyOptional({
    example: 'Access Bank',
    minLength: 2,
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional({
    example: '9876543210',
    description: '6-20 digits, no spaces or dashes.',
    pattern: '^\\d{6,20}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,20}$/, {
    message: 'accountNumber must be 6-20 digits',
  })
  accountNumber?: string;

  @ApiPropertyOptional({
    example: 'Michael Adeleke',
    minLength: 2,
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountName?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Setting to `true` makes this the default payout destination; ' +
      'the previously-default account is auto-unset.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
