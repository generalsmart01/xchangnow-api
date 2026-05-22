import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';

export class CreateSellDto {
  @IsEnum(CryptoAsset)
  cryptoAsset!: CryptoAsset;

  @IsEnum(CryptoNetwork)
  network!: CryptoNetwork;

  // String to preserve precision — JSON numbers > 2^53 lose digits.
  @IsString()
  @Matches(/^\d+(\.\d{1,18})?$/, {
    message: 'cryptoAmount must be a decimal number with up to 18 decimals',
  })
  @MaxLength(40)
  cryptoAmount!: string;
}
