// src/modules/auth/dto/accept-invite.dto.ts

/**
 * Body schema for POST /auth/accept-invite.
 *
 * Called by an invited staff member from the frontend /accept-invite page
 * after they click the link in their invite email. On success the server
 * atomically: sets the password, flips the user to ACTIVE +
 * isEmailVerified=true (clicking the email link proves email ownership),
 * marks the invite token used, and writes a security_log row.
 *
 * Does NOT auto-issue tokens — staff still has to log in normally
 * afterwards. Keeps the flow explicit and means a leaked invite link
 * can't silently grant a session.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty({
    example: 'a1b2c3d4...',
    description:
      'Raw invite token from the email link. The backend hashes this and ' +
      'matches against InviteToken.tokenHash.',
    minLength: 20,
    maxLength: 200,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @ApiProperty({
    example: 'StaffP@ss1!',
    description:
      'New password for the staff member. Same strength rule as register: ' +
      '8-128 chars, with uppercase, lowercase, and a digit.',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/, {
    message:
      'Password must contain an uppercase letter, a lowercase letter, and a number',
  })
  password!: string;
}
