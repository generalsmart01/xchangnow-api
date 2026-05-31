// src/modules/auth/dto/resend-verification.dto.ts

/**
 * Body schema for POST /auth/resend-verification.
 *
 * Just the email. Response is generic regardless of whether the email is
 * registered, already verified, or unknown — designed to prevent account
 * enumeration. Server-side: invalidates any prior verification tokens for
 * the user and issues a fresh one.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class ResendVerificationDto {
  @ApiProperty({
    example: 'michael@xchangnow.com',
    description:
      'Email of the unverified account. Response is the same regardless of ' +
      'whether the account exists or is already verified — by design, to avoid ' +
      'account enumeration.',
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
