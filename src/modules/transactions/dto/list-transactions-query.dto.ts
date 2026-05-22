import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CryptoAsset,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListTransactionsQueryDto {
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
    enum: TransactionStatus,
    example: TransactionStatus.UNDER_REVIEW,
    description: 'Filter by transaction status.',
  })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({
    enum: TransactionType,
    example: TransactionType.SELL,
    description: 'Filter by transaction type.',
  })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({
    enum: CryptoAsset,
    example: CryptoAsset.BTC,
    description: 'Filter by crypto asset.',
  })
  @IsOptional()
  @IsEnum(CryptoAsset)
  asset?: CryptoAsset;

  @ApiPropertyOptional({
    example: 'cmpgx5qjh0000o85kzmyj8zpy',
    description:
      'Admin-only: filter by user id. Ignored for non-admin callers (the ' +
      '/me routes always scope to the caller).',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
