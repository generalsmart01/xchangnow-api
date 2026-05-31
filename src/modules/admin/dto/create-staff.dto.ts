// src/modules/admin/dto/create-staff.dto.ts

/**
 * Body schema for POST /admin/staff (SUPER_ADMIN only).
 *
 * `role` uses @IsIn (not @IsEnum) so SUPER_ADMIN and USER are explicitly
 * rejected at the DTO layer — even before reaching the service. Defence in
 * depth: the service re-checks. This makes the "no in-app path to
 * SUPER_ADMIN" invariant impossible to bypass through validation gaps.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsPhoneNumberE164 } from '../../../common/validators/is-phone-number-e164.decorator';

/**
 * Roles that can be assigned via the invite flow. Crucially this does NOT
 * include SUPER_ADMIN — that role is only granted via the seed script
 * (prisma/seed.ts) to prevent any in-app path to escalation.
 */
const INVITABLE_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.OPS,
  UserRole.CUSTOMER_SERVICE,
];

export class CreateStaffDto {
  @ApiProperty({
    example: 'ops1@xchangnow.com',
    description: 'Email of the new staff member. Must be unique.',
    maxLength: 254,
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Tunde',
    description: 'First / given name.',
    minLength: 1,
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName!: string;

  @ApiProperty({
    example: 'Bello',
    description: 'Last / family name.',
    minLength: 1,
    maxLength: 60,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName!: string;

  @ApiProperty({
    enum: INVITABLE_ROLES,
    example: UserRole.OPS,
    description:
      'Role to grant. Only ADMIN | OPS | CUSTOMER_SERVICE are invitable. ' +
      'SUPER_ADMIN can only be created via the bootstrap seed script.',
  })
  // @IsIn (not @IsEnum) so SUPER_ADMIN and USER are explicitly rejected at the
  // DTO layer — defence in depth on top of the service-layer check.
  @IsIn(INVITABLE_ROLES, {
    message: 'role must be one of: ADMIN, OPS, CUSTOMER_SERVICE',
  })
  role!: UserRole;

  @ApiPropertyOptional({
    example: '08012345670',
    description:
      'Optional Nigerian phone number. Country code +234 is assumed. Accepts ' +
      '"08012345670", "8012345670", "2348012345670", or "+2348012345670" ' +
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
