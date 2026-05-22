import { ApiProperty } from '@nestjs/swagger';
import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';

export class CreateBuyDto {
  @ApiProperty({
    enum: CryptoAsset,
    example: CryptoAsset.USDT,
    description: 'The crypto asset the user wants to buy from us.',
  })
  @IsEnum(CryptoAsset)
  cryptoAsset!: CryptoAsset;

  @ApiProperty({
    enum: CryptoNetwork,
    example: CryptoNetwork.TRON,
    description: 'Network on which the user wants to receive crypto.',
  })
  @IsEnum(CryptoNetwork)
  network!: CryptoNetwork;

  @ApiProperty({
    example: '30000.00',
    description:
      'NGN amount the user will pay. Decimal string, up to 2 places. ' +
      'The crypto amount the user receives is computed server-side using ' +
      'the current buyRate from RatesModule.',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'fiatAmount must be a number with up to 2 decimal places',
  })
  @MaxLength(20)
  fiatAmount!: string;
}
