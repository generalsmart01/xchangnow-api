import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Same fields as create, all optional.
// Kept explicit instead of using @nestjs/mapped-types to avoid an extra dep.
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
