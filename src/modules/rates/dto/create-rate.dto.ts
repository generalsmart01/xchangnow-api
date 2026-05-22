import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CryptoAsset } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateRateDto {
  @ApiProperty({
    enum: CryptoAsset,
    example: CryptoAsset.BTC,
    description: 'Crypto asset this rate covers: BTC | ETH | USDT | USDC.',
  })
  @IsEnum(CryptoAsset)
  asset!: CryptoAsset;

  @ApiProperty({
    example: '60000000.00',
    description:
      'Rate at which WE sell this asset to users (fiat per 1 unit of crypto). ' +
      'Used to price BUY transactions. Decimal string, up to 2 places.',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'buyRate must be a decimal number with up to 2 decimal places',
  })
  @MaxLength(20)
  buyRate!: string;

  @ApiProperty({
    example: '58000000.00',
    description:
      'Rate at which WE buy this asset from users (fiat per 1 unit). ' +
      'Used to price SELL transactions. Should be < buyRate (spread is our fee).',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'sellRate must be a decimal number with up to 2 decimal places',
  })
  @MaxLength(20)
  sellRate!: string;

  @ApiPropertyOptional({
    example: 'NGN',
    description: 'Fiat currency. Defaults to NGN.',
    default: 'NGN',
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  fiatCurrency?: string;

  @ApiPropertyOptional({
    example: 'manual',
    description:
      'Where this rate came from: "manual" (admin entry), "coingecko", "binance", etc. ' +
      'Defaults to "manual". `isManualOverride` on the stored row is auto-set true ' +
      'when source is "manual" or omitted.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}
