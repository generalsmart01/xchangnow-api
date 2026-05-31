// src/modules/rates/dto/list-rates-query.dto.ts

/**
 * Query schema for GET /rates (admin paginated rate history).
 *
 * Ordered newest first. Filters by assetId and/or fiatCurrency are useful
 * when an admin wants to inspect "how has the BTC/NGN rate moved over
 * the last 24 hours?"
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
    example: 'cmpqd99zz0000o81g4kq8jz5x',
    description: 'Filter by assetId (cuid) to see only that asset\'s rate history.',
  })
  @IsOptional()
  @IsString()
  assetId?: string;

  @ApiPropertyOptional({
    example: 'NGN',
    description: 'Filter by fiat currency (defaults to no filter).',
  })
  @IsOptional()
  @IsString()
  fiatCurrency?: string;
}
