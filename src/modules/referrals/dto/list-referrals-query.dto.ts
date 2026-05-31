// src/modules/referrals/dto/list-referrals-query.dto.ts

/**
 * Query schema shared by:
 *   - GET /referrals/me/referees   list of users I referred
 *   - GET /referrals/me/earnings   list of commissions I earned
 *
 * Pagination only — no filters yet. Once the FE needs filters (status,
 * date range), add them here without touching the service signatures.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListReferralsQueryDto {
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
}
