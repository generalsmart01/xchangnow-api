// src/modules/users/dto/anonymize-user.dto.ts

/**
 * Body schema for POST /users/:id/anonymize (admin).
 *
 * Anonymization is irreversible and high-impact (scrubs PII from User,
 * Profile, and BankAccount tables; revokes all sessions; deletes
 * outstanding tokens). To prevent fat-finger deletions, the admin MUST
 * confirm by re-typing the target user's email in the body — the service
 * compares it against the stored email and refuses with 400 if it doesn't
 * match. This is the standard "type to confirm" pattern (GitHub, Stripe,
 * AWS all use it for destructive actions).
 *
 * `reason` is required and stored in security_logs (HIGH severity) plus
 * admin_logs for compliance review.
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class AnonymizeUserDto {
  @ApiProperty({
    example: 'michael@xchangnow.com',
    description:
      "Confirm by typing the target user's current email. Must match " +
      'exactly (case-insensitive); refused with 400 otherwise. This is a ' +
      "guard against deleting the wrong user when you've fat-fingered the " +
      'id in the URL.',
  })
  @IsEmail()
  @MaxLength(254)
  confirmEmail!: string;

  @ApiProperty({
    example: 'User requested account deletion under NDPR Article 26',
    description:
      'Mandatory human-readable justification (5-500 chars). Captured in ' +
      'security_logs with HIGH severity and admin_logs.beforeState.',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
