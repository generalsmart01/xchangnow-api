// src/modules/users/dto/admin-update-user-status.dto.ts

/**
 * Body schema for PATCH /users/:id/status (admin).
 *
 * Used to suspend / reactivate / re-flag for verification. The service
 * refuses self-deactivation — admins can't lock themselves out.
 *
 * `reason` is optional but strongly encouraged — it's captured in both
 * user_activity_logs and pii_access_logs for compliance review.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminUpdateUserStatusDto {
  @ApiProperty({
    enum: UserStatus,
    example: UserStatus.SUSPENDED,
    description:
      'New status: ACTIVE | SUSPENDED | PENDING_VERIFICATION | DEACTIVATED. ' +
      'Admins cannot move themselves to any value other than ACTIVE.',
  })
  @IsEnum(UserStatus)
  status!: UserStatus;

  @ApiPropertyOptional({
    example: 'Account flagged for KYC review',
    description: 'Optional human-readable reason. Captured in user_activity_logs.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
