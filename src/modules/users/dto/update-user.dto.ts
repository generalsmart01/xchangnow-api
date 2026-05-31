// src/modules/users/dto/update-user.dto.ts

/**
 * Body schema for PATCH /users/me.
 *
 * Every field is optional — only what's sent is changed. Omit a field to
 * leave it untouched (Prisma semantics). Setting `phoneNumber` to "" clears
 * the phone (both raw and normalized null'd in the service).
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsPhoneNumberE164 } from '../../../common/validators/is-phone-number-e164.decorator';

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'Michael',
    description: 'New first name.',
    minLength: 1,
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Adeleke',
    description: 'New last name.',
    minLength: 1,
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName?: string;

  @ApiPropertyOptional({
    example: '08012345678',
    description:
      'New Nigerian phone number. Country code +234 is assumed. Accepts ' +
      '"08012345678", "8012345678", "2348012345678", or "+2348012345678" ' +
      '(spaces/dashes stripped). Normalized to E.164 server-side. Only ' +
      'Nigerian numbers are accepted today.',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsPhoneNumberE164()
  phoneNumber?: string;
}
