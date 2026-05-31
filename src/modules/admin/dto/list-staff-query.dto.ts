// src/modules/admin/dto/list-staff-query.dto.ts

/**
 * Query schema for GET /admin/staff (ADMIN | SUPER_ADMIN).
 *
 * Implicitly scopes to `role != USER` server-side — this endpoint is
 * specifically for the staff list. To find regular users, use GET /users.
 *
 * Filters by role (e.g. "show me all OPS") and status (e.g. "show me
 * pending invitations" via status=PENDING_VERIFICATION).
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListStaffQueryDto {
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
    enum: UserRole,
    example: UserRole.OPS,
    description:
      'Filter by role. Useful for "show me all CUSTOMER_SERVICE staff". ' +
      'Omitting returns all non-USER staff.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: UserStatus,
    example: UserStatus.ACTIVE,
    description: 'Filter by status.',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
