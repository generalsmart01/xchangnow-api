// src/modules/auth/dto/forgot-password.dto.ts

/**
 * Body schema for POST /auth/forgot-password.
 *
 * Just the email. Response is generic regardless of whether the email
 * exists — same enumeration-prevention pattern as resend-verification.
 * In DEV mode the response ALSO includes the raw `resetToken` so smoke
 * tests can drive the reset flow without reading email logs.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'michael@xchangnow.com',
    description:
      'Email of the account that forgot its password. Response is generic ' +
      "regardless of whether the email exists — don't leak account existence.",
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
