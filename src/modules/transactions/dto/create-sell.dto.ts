import { ApiProperty } from '@nestjs/swagger';
import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';

export class CreateSellDto {
  @ApiProperty({
    enum: CryptoAsset,
    example: CryptoAsset.BTC,
    description: 'The crypto asset the user is selling to us.',
  })
  @IsEnum(CryptoAsset)
  cryptoAsset!: CryptoAsset;

  @ApiProperty({
    enum: CryptoNetwork,
    example: CryptoNetwork.BITCOIN,
    description: 'Network the user will send crypto on. Must match asset.',
  })
  @IsEnum(CryptoNetwork)
  network!: CryptoNetwork;

  @ApiProperty({
    example: '0.005',
    description:
      'Amount of crypto the user is selling, as a decimal string. ' +
      'Sent as STRING (not number) to preserve precision beyond 2^53. ' +
      'Up to 18 decimal places.',
    pattern: '^\\d+(\\.\\d{1,18})?$',
  })
  // String to preserve precision — JSON numbers > 2^53 lose digits.
  @IsString()
  @Matches(/^\d+(\.\d{1,18})?$/, {
    message: 'cryptoAmount must be a decimal number with up to 18 decimals',
  })
  @MaxLength(40)
  cryptoAmount!: string;
}
