// src/modules/admin/dto/bootstrap-super-admin.dto.ts

/**
 * Body schema for POST /admin/bootstrap.
 *
 * One-time bootstrap of the initial SUPER_ADMIN account. The `secret` field
 * MUST match the `BOOTSTRAP_SECRET` env var (timing-safe compare) — that's
 * the only auth the endpoint has, since by definition no SUPER_ADMIN exists
 * yet to authenticate against.
 *
 * Stricter password rule than RegisterDto (12+ chars vs 8+) — SUPER_ADMIN
 * has the keys to the kingdom.
 */

import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class BootstrapSuperAdminDto {
  @ApiProperty({
    example: 'kJ8xQ3pNzV9aRtBmL2sE5cY7hF1nG4dW6vU0iO8kP2qX-AbCdEfGhIjKlMnOpQrS',
    description:
      'The shared secret matching the `BOOTSTRAP_SECRET` env var. Compared ' +
      'timing-safely server-side. If the env var is unset, this endpoint ' +
      'returns 404 (pretends not to exist).',
    minLength: 32,
    maxLength: 200,
  })
  @IsString()
  @MinLength(32)
  @MaxLength(200)
  secret!: string;

  @ApiProperty({
    example: 'admin@xchangnow.com',
    description: 'Email for the first SUPER_ADMIN account.',
    maxLength: 254,
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'C0rrectH0rseBatteryStaple!2026',
    description:
      'Password — 12-128 chars, must contain uppercase, lowercase, and digit. ' +
      'Stricter floor than regular users (8+) because SUPER_ADMIN is high-value.',
    minLength: 12,
    maxLength: 128,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/, {
    message:
      'Password must contain an uppercase letter, a lowercase letter, and a number',
  })
  password!: string;

  @ApiProperty({
    example: 'Super',
    description: 'First / given name. Used on KYC and audit displays.',
    minLength: 1,
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName!: string;

  @ApiProperty({
    example: 'Admin',
    description: 'Last / family name.',
    minLength: 1,
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName!: string;
}
