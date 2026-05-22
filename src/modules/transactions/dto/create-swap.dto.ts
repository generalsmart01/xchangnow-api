import { ApiProperty } from '@nestjs/swagger';
import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import {
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSwapDto {
  @ApiProperty({
    enum: CryptoAsset,
    example: CryptoAsset.BTC,
    description: 'Asset the user is sending to us.',
  })
  @IsEnum(CryptoAsset)
  fromAsset!: CryptoAsset;

  @ApiProperty({
    enum: CryptoNetwork,
    example: CryptoNetwork.BITCOIN,
    description: 'Network for the FROM side.',
  })
  @IsEnum(CryptoNetwork)
  fromNetwork!: CryptoNetwork;

  @ApiProperty({
    example: '0.005',
    description:
      'Amount of FROM asset. Decimal string, up to 18 decimals.',
    pattern: '^\\d+(\\.\\d{1,18})?$',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,18})?$/, {
    message: 'fromAmount must be a decimal number with up to 18 decimals',
  })
  @MaxLength(40)
  fromAmount!: string;

  @ApiProperty({
    enum: CryptoAsset,
    example: CryptoAsset.USDT,
    description:
      'Asset the user wants to receive. Must differ from fromAsset (400 if equal).',
  })
  @IsEnum(CryptoAsset)
  toAsset!: CryptoAsset;

  @ApiProperty({
    enum: CryptoNetwork,
    example: CryptoNetwork.TRON,
    description: 'Network where we will send the TO asset.',
  })
  @IsEnum(CryptoNetwork)
  toNetwork!: CryptoNetwork;

  @ApiProperty({
    example: 'TJYeasTPa6gpEEfYYhfA3HzfwPV82dB9Vt',
    description:
      'User\'s wallet address that will receive the TO asset after admin ' +
      'approves the swap and marks it completed. Length-validated only (20-120 chars); ' +
      'per-chain format validation is up to the FE / admin to enforce.',
    minLength: 20,
    maxLength: 120,
  })
  // User's wallet where we'll send the TO asset after admin approval.
  // Validated by length only — chain-specific format checks would need
  // per-asset libraries (bitcoin-address-validation, etc.).
  @IsString()
  @MinLength(20)
  @MaxLength(120)
  toAddress!: string;
}
