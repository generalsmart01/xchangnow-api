// src/modules/kyc/dto/list-kyc-query.dto.ts

/**
 * Query schema for GET /kyc (admin KYC review queue).
 *
 * Default sort is oldest-first within the chosen status — typical use is
 * "show me the oldest PENDING submission so I clear the queue fairly", not
 * "show me newest". Admin can flip by clicking the column header on the FE;
 * the API doesn't expose sort options here yet.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { KycStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListKycQueryDto {
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
    enum: KycStatus,
    example: KycStatus.PENDING,
    description: 'Filter by status. Defaults to no filter (all statuses).',
  })
  @IsOptional()
  @IsEnum(KycStatus)
  status?: KycStatus;
}
