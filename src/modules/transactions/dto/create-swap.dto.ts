import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import {
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSwapDto {
  @IsEnum(CryptoAsset)
  fromAsset!: CryptoAsset;

  @IsEnum(CryptoNetwork)
  fromNetwork!: CryptoNetwork;

  @IsString()
  @Matches(/^\d+(\.\d{1,18})?$/, {
    message: 'fromAmount must be a decimal number with up to 18 decimals',
  })
  @MaxLength(40)
  fromAmount!: string;

  @IsEnum(CryptoAsset)
  toAsset!: CryptoAsset;

  @IsEnum(CryptoNetwork)
  toNetwork!: CryptoNetwork;

  // User's wallet where we'll send the TO asset after admin approval.
  // Validated by length only — chain-specific format checks would need
  // per-asset libraries (bitcoin-address-validation, etc.).
  @IsString()
  @MinLength(20)
  @MaxLength(120)
  toAddress!: string;
}
