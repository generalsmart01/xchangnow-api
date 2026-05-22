import { CryptoAsset } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRateDto {
  @IsEnum(CryptoAsset)
  asset!: CryptoAsset;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'buyRate must be a decimal number with up to 2 decimal places',
  })
  @MaxLength(20)
  buyRate!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'sellRate must be a decimal number with up to 2 decimal places',
  })
  @MaxLength(20)
  sellRate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  fiatCurrency?: string; // defaults to NGN

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string; // 'manual' | 'coingecko' | 'binance' | etc.
}
