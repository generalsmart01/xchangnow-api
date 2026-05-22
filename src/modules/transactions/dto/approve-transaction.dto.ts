import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveTransactionDto {
  @ApiPropertyOptional({
    example: 'Tx hash verified on Blockstream',
    description: 'Optional admin notes captured in the audit log.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
