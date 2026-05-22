import { PayoutStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePayoutStatusDto {
  @IsEnum(PayoutStatus)
  status!: PayoutStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  failureReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string; // optional bank reference, e.g. external transfer ID
}
