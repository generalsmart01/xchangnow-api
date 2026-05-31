// src/modules/transactions/dto/list-transactions-query.dto.ts

/**
 * Query schema for GET /transactions (admin) and /transactions/me (self).
 *
 * The same DTO serves both endpoints — the controller passes the caller's
 * userId for the /me variant, the admin variant doesn't. The `userId`
 * filter field is admin-only (admins can filter to a specific user); the
 * service ignores it on /me routes to prevent privilege escalation.
 *
 * `assetId` / `assetNetworkId` filter by the PRIMARY side (BUY/SELL asset
 * or SWAP from-side). To find SWAPs by the receive-side, you'd need a
 * separate filter — not implemented; admins can sort/inspect after listing.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
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
    example: 'cmpqd99zz0000o81g4kq8jz5x',
    description: 'Filter by primary assetId (the BUY/SELL asset or SWAP from-side asset).',
  })
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional({
    example: 'cmpqe002b0001o81g8k7vmpqr',
    description: 'Filter by primary assetNetworkId (more specific than assetId).',
  })
  @IsOptional()
  @IsString()
  assetNetworkId?: string;

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
