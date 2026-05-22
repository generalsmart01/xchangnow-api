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
  @IsEnum(CryptoAsset)
  cryptoAsset!: CryptoAsset;

  @IsEnum(CryptoNetwork)
  network!: CryptoNetwork;

  @IsString()
  @MinLength(20)
  @MaxLength(120)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
