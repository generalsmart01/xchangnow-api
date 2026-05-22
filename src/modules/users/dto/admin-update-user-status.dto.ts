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
