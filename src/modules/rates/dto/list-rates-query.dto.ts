import { ApiPropertyOptional } from '@nestjs/swagger';
import { CryptoAsset } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListRatesQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    enum: CryptoAsset,
    example: CryptoAsset.BTC,
    description: 'Filter by asset to see only that asset\'s rate history.',
  })
  @IsOptional()
  @IsEnum(CryptoAsset)
  asset?: CryptoAsset;

  @ApiPropertyOptional({
    example: 'NGN',
    description: 'Filter by fiat currency (defaults to no filter).',
  })
  @IsOptional()
  @IsString()
  fiatCurrency?: string;
}
