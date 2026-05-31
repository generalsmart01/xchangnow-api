// src/modules/auth/dto/register.dto.ts

/**
 * Body schema for POST /auth/register.
 *
 * Validation:
 *   - email          RFC-shaped, max 254 chars
 *   - password       8-128 chars, must contain uppercase + lowercase + digit
 *   - firstName      1-60 chars
 *   - lastName       1-60 chars
 *   - phoneNumber    optional, Nigerian only (see @IsPhoneNumberE164)
 *   - referralCode   optional, the code of the user who referred this signup;
 *                    unknown codes → 400 (don't silently drop attribution)
 *
 * Server-side post-validation:
 *   - email + phone are normalized before storage (see auth.service.register)
 *   - email also stored canonical (lowercased) for uniqueness lookups
 *   - phone also stored canonical (E.164) for uniqueness lookups
 *   - the new user is minted their OWN referralCode (XCN-XXXXXX); if
 *     `referralCode` was supplied, `User.referredById` is bound to the
 *     resolved referrer
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsPhoneNumberE164 } from '../../../common/validators/is-phone-number-e164.decorator';

export class RegisterDto {
  @ApiProperty({
    example: 'michael@xchangnow.com',
    description: 'Valid email address. Must be unique.',
    maxLength: 254,
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'StrongP@ss1',
    description:
      'Must be 8-128 chars and contain at least one uppercase letter, ' +
      'one lowercase letter, and one number.',
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

  @ApiProperty({
    example: 'Michael',
    description: 'First / given name. Used on KYC and bank payouts.',
    minLength: 1,
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName!: string;

  @ApiProperty({
    example: 'Adeleke',
    description: 'Last / family name. Used on KYC and bank payouts.',
    minLength: 1,
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName!: string;

  @ApiPropertyOptional({
    example: '08012345678',
    description:
      'Optional Nigerian phone number. Country code +234 is assumed — the ' +
      'backend normalizes any of these formats to canonical E.164 ' +
      '"+2348012345678":\n' +
      '  - "08012345678"      (local with leading 0)\n' +
      '  - "8012345678"       (local without leading 0)\n' +
      '  - "2348012345678"    (E.164 without +)\n' +
      '  - "+2348012345678"   (E.164)\n' +
      'Spaces, dashes, and parentheses are stripped. Two users cannot ' +
      'register the same number in different formats (uniqueness is enforced ' +
      'on the normalized form). Only Nigerian numbers are accepted today.',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsPhoneNumberE164()
  phoneNumber?: string;

  @ApiPropertyOptional({
    example: 'XCN-A8K2P9',
    description:
      "Optional referral code of the user who referred this signup. If " +
      'provided, must match an existing user\'s referralCode (case-insensitive). ' +
      'Unknown codes are rejected with 400 rather than silently ignored ' +
      "— prevents \"my friend's code didn't work\" support tickets where " +
      'attribution silently failed. Binding is ONE-TIME and immutable; you ' +
      "can't change your referrer post-signup.",
    minLength: 10,
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  referralCode?: string;
}
