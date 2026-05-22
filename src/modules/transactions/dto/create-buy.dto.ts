import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';

export class CreateBuyDto {
  @IsEnum(CryptoAsset)
  cryptoAsset!: CryptoAsset;

  @IsEnum(CryptoNetwork)
  network!: CryptoNetwork;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'fiatAmount must be a number with up to 2 decimal places',
  })
  @MaxLength(20)
  fiatAmount!: string; // NGN
}
