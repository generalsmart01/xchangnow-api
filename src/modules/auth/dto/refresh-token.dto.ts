// src/modules/auth/dto/refresh-token.dto.ts

/**
 * Body schema for POST /auth/refresh.
 *
 * The refresh token is a 48-byte random string, base64url-encoded. The
 * server compares its SHA-256 hash against `user_sessions.refresh_token_hash`
 * — the raw token is never stored at rest, so a DB leak alone cannot mint
 * new access tokens.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example:
      'eEt8r2Vh3LkPq9aBxNm-zQ4cF5sJ7uYg8WdRtHbXjAvKp1Nc6QzMeUyT0gWiOvLs',
    description:
      'The `refreshToken` you received from POST /auth/login (or the most recent /auth/refresh). ' +
      'Single-use — the server rotates this on every successful refresh.',
  })
  @IsString()
  refreshToken!: string;
}
