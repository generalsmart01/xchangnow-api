// src/modules/payouts/dto/list-payouts-query.dto.ts

/**
 * Query schema for GET /payouts (admin) and /payouts/me (self).
 *
 * Same dual-purpose pattern as ListTransactionsQueryDto — `userId` filter
 * is only honored on the admin route; the /me route scopes by the caller.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListPayoutsQueryDto {
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
    enum: PayoutStatus,
    example: PayoutStatus.PENDING,
    description: 'Filter by payout status.',
  })
  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

  @ApiPropertyOptional({
    example: 'cmpgx5qjh0000o85kzmyj8zpy',
    description:
      'Admin-only: filter by the underlying transaction\'s userId. ' +
      'Ignored on /payouts/me (always scoped to caller).',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
