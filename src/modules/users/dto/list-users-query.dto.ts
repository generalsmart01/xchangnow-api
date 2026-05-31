// src/modules/users/dto/list-users-query.dto.ts

/**
 * Query schema for GET /users (admin paginated user list).
 *
 * Pagination is 1-indexed (page=1 is the first page) to match what FE
 * tables typically render. Max pageSize=100 — keeps single-query cost
 * bounded and dissuades the FE from "just fetch them all" patterns.
 *
 * Search is a substring match (case-insensitive) on email + firstName +
 * lastName. The Prisma query OR's the three fields; not a fancy full-text
 * search but adequate for the admin "find user by partial name" workflow.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '1-indexed page number.',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Rows per page (max 100).',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    enum: UserStatus,
    example: UserStatus.ACTIVE,
    description: 'Filter by user status.',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    example: 'michael',
    description:
      'Partial match (case-insensitive) on email, firstName, or lastName.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
