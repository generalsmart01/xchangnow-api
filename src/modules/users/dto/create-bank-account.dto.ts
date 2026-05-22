import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  bankName!: string;

  @IsString()
  @Matches(/^\d{6,20}$/, {
    message: 'accountNumber must be 6-20 digits',
  })
  accountNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountName!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
