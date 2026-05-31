// src/modules/rates/dto/update-rate.dto.ts

/**
 * Body schema for PATCH /rates/:id (admin).
 *
 * Only buyRate / sellRate / source are mutable. Asset and fiatCurrency are
 * effectively identity columns — changing them would be a different rate
 * row entirely. To "change" those: DELETE the wrong one + POST a fresh
 * snapshot.
 *
 * Prefer POSTing new snapshots over PATCHing existing ones — this endpoint
 * is for typo fixes only.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateRateDto {
  @ApiPropertyOptional({
    example: '70000000.00',
    description: 'New buyRate (fiat per crypto unit when WE sell to users).',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @MaxLength(20)
  buyRate?: string;

  @ApiPropertyOptional({
    example: '68000000.00',
    description: 'New sellRate (fiat per crypto unit when WE buy from users).',
    pattern: '^\\d+(\\.\\d{1,2})?$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  @MaxLength(20)
  sellRate?: string;

  @ApiPropertyOptional({
    example: 'manual-correction',
    description: 'New source tag. Useful for marking corrections.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}
