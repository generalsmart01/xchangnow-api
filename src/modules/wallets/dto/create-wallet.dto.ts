import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CryptoAsset, CryptoNetwork } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateWalletDto {
  @ApiProperty({
    enum: CryptoAsset,
    example: CryptoAsset.BTC,
    description: 'Crypto asset this address holds: BTC | ETH | USDT | USDC.',
  })
  @IsEnum(CryptoAsset)
  cryptoAsset!: CryptoAsset;

  @ApiProperty({
    enum: CryptoNetwork,
    example: CryptoNetwork.BITCOIN,
    description:
      'Network the address lives on: BITCOIN | ETHEREUM | TRON | BSC | POLYGON. ' +
      'Asset+network combo must be valid (e.g. USDT-TRON, BTC-BITCOIN).',
  })
  @IsEnum(CryptoNetwork)
  network!: CryptoNetwork;

  @ApiProperty({
    example: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    description:
      'On-chain address that will receive deposits. Validated only for length ' +
      '(20-120 chars); per-chain format validation is up to the admin entering it.',
    minLength: 20,
    maxLength: 120,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(120)
  address!: string;

  @ApiPropertyOptional({
    example: 'Primary BTC hot wallet',
    description: 'Optional human-readable label for the wallet (admin-only field).',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'If false, the wallet won\'t be picked by `pickActiveWallet()` for new ' +
      'transactions. Use it to retire an address without deleting historical data.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
