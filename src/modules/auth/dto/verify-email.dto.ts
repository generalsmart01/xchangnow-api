// src/modules/auth/dto/verify-email.dto.ts

/**
 * Body schema for POST /auth/verify-email.
 *
 * Token comes from the email link: `${FRONTEND_URL}/verify-email?token=...`.
 * Frontend `/verify-email` page parses the query param and posts here. The
 * server SHA-256 hashes the token, looks up `email_verification_tokens`,
 * and on match flips the user to ACTIVE + isEmailVerified=true atomically
 * with deleting that user's outstanding verification tokens.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    example: 'kZ8a3bcD-fGh4iJkLmNoPqRsTuVwXyZ0123456789abcdef',
    description:
      'The opaque token that came in the verification email link ' +
      '(or, in dev mode, in the `verifyToken` field of the register response).',
    minLength: 20,
    maxLength: 200,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}
