// src/modules/admin/dto/update-staff-role.dto.ts

/**
 * Body schema for PATCH /admin/staff/:id/role (SUPER_ADMIN only).
 *
 * Same @IsIn pattern as CreateStaffDto — rejects SUPER_ADMIN and USER
 * targets at the validation layer. The service also re-checks (defence
 * in depth) AND refuses to mutate users whose current role is SUPER_ADMIN
 * (you can't demote a SUPER_ADMIN through this endpoint either).
 *
 * `reason` flows through to admin_logs for the audit trail; not required
 * but strongly encouraged.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const ROLE_CHANGE_TARGETS: UserRole[] = [
  UserRole.ADMIN,
  UserRole.OPS,
  UserRole.CUSTOMER_SERVICE,
];

export class UpdateStaffRoleDto {
  @ApiProperty({
    enum: ROLE_CHANGE_TARGETS,
    example: UserRole.ADMIN,
    description:
      'New role. Only ADMIN | OPS | CUSTOMER_SERVICE are settable here. ' +
      'You cannot promote anyone to SUPER_ADMIN (only the seed script can). ' +
      'You also cannot demote/promote a SUPER_ADMIN through this endpoint ' +
      '(service-layer check). To remove a staff member, change their status ' +
      'to DEACTIVATED via PATCH /users/:id/status.',
  })
  @IsIn(ROLE_CHANGE_TARGETS, {
    message: 'role must be one of: ADMIN, OPS, CUSTOMER_SERVICE',
  })
  role!: UserRole;

  @ApiPropertyOptional({
    example: 'Promoted from OPS after Q2 review',
    description: 'Optional reason captured in admin_logs for audit.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
