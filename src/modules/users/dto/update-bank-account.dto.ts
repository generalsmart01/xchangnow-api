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
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6,20}$/, {
    message: 'accountNumber must be 6-20 digits',
  })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountName?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
