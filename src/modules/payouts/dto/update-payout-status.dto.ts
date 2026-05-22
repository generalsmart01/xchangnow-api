import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePayoutStatusDto {
  @ApiProperty({
    enum: PayoutStatus,
    example: PayoutStatus.PROCESSING,
    description:
      'New payout status. Allowed transitions: ' +
      'PENDING → PROCESSING | PAID | FAILED; ' +
      'PROCESSING → PAID | FAILED; ' +
      'FAILED → PENDING (retry); ' +
      'PAID is terminal. Setting PAID also auto-completes the parent transaction.',
  })
  @IsEnum(PayoutStatus)
  status!: PayoutStatus;

  @ApiPropertyOptional({
    example: 'Beneficiary bank rejected transfer',
    description:
      'Required-by-convention when status=FAILED (defaults to "No reason provided" if omitted). Ignored for other statuses.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  failureReason?: string;

  @ApiPropertyOptional({
    example: 'BANK-TXN-9988',
    description:
      'External bank reference / processor transaction id. Typically set when ' +
      'moving to PROCESSING. Stored on the payout for cross-system reconciliation.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}
