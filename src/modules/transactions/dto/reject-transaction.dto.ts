import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectTransactionDto {
  @ApiProperty({
    example: 'Receipt unreadable; please re-submit',
    description:
      'Mandatory human-readable rejection reason. Surfaced to the user and ' +
      'recorded in user_activity_logs.',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
