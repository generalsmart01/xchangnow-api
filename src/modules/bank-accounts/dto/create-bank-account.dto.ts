// src/modules/bank-accounts/dto/create-bank-account.dto.ts

/**
 * Body schema for POST /bank-accounts/me.
 *
 * Uniqueness: the DB enforces unique (userId, bankName, accountNumber) —
 * the same person can't double-register the same account at the same bank,
 * but two users CAN share an account number across different banks (and
 * one user CAN have the same account number at two different banks).
 *
 * isDefault semantics: setting true atomically un-flags any existing default
 * for this user (service handles in a single transaction).
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({
    example: 'Guaranty Trust Bank',
    description: 'Name of the bank (free text).',
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankName!: string;

  @ApiProperty({
    example: '0123456789',
    description: 'Account number — must be 6-20 digits, no spaces or dashes.',
    pattern: '^\\d{6,20}$',
  })
  @IsString()
  @Matches(/^\d{6,20}$/, {
    message: 'accountNumber must be 6-20 digits',
  })
  accountNumber!: string;

  @ApiProperty({
    example: 'Michael Adeleke',
    description: 'Account holder name as registered with the bank.',
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountName!: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'If true, this becomes the user\'s default payout destination. ' +
      'Setting another account default later auto-unsets this one.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
