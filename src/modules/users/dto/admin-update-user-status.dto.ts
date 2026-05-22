import { UserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdminUpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
