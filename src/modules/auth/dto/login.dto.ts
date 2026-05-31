// src/modules/auth/dto/login.dto.ts

/**
 * Body schema for POST /auth/login.
 *
 * Both fields are required. Email is intentionally not @MaxLength-constrained
 * here — let the service-side normalization + lookup handle it. The reason:
 * matching the registration constraints exactly might prevent legitimate
 * users from logging in with an email that's slightly different from what
 * they remember (extra whitespace, etc.). The server normalizes and looks
 * up — generic 401 if it fails for any reason.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'michael@xchangnow.com',
    description: 'Registered email (case-insensitive).',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'StrongP@ss1',
    description: 'The password supplied at registration.',
  })
  @IsString()
  password!: string;
}
