// src/modules/admin/staff.controller.ts

/**
 * ─── Endpoints (under /api/admin/staff) ─────────────────────────────────────
 *
 *   POST   /admin/staff               JWT + SUPER_ADMIN
 *                                     body: CreateStaffDto
 *                                     201: invited user (PENDING_VERIFICATION)
 *                                     409: email or phone already registered
 *
 *   GET    /admin/staff               JWT + ADMIN | SUPER_ADMIN
 *                                     query: role/status/page/pageSize
 *                                     200: paginated non-USER accounts
 *
 *   PATCH  /admin/staff/:id/role      JWT + SUPER_ADMIN
 *                                     body: UpdateStaffRoleDto
 *                                     200: updated user
 *                                     403: self-promotion / target is SUPER_ADMIN
 *                                     404: not found
 *
 * SUPER_ADMIN can only be created via the bootstrap seed script, never
 * via these endpoints. The PATCH role endpoint also refuses any attempt
 * to set role=SUPER_ADMIN (validated at DTO + service layers).
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LogMessage } from '../../common/decorators/log-message.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffRoleDto } from './dto/update-staff-role.dto';
import { StaffService } from './staff.service';
import { PrismaService } from '../../database/prisma.service';

const STAFF_EXAMPLE = {
  id: 'cmpgx5qjh0000o85kzmyj8zpy',
  email: 'ops1@xchangnow.com',
  phoneNumber: '+2348012345670',
  firstName: 'Tunde',
  lastName: 'Bello',
  role: 'OPS',
  status: 'PENDING_VERIFICATION',
  isEmailVerified: false,
  lastLoginAt: null,
  lastLoginIp: null,
  createdAt: '2026-05-23T14:30:00.000Z',
  updatedAt: '2026-05-23T14:30:00.000Z',
  deletedAt: null,
};

@ApiTags('Admin — Staff')
@ApiBearerAuth('JWT-auth')
@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard) // JWT + role gate apply to all routes
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @LogMessage('Staff invited')
  @ApiOperation({
    summary: '(SUPER_ADMIN) Invite a new staff member',
    description:
      'Creates a staff user with `status=PENDING_VERIFICATION` and no usable ' +
      'password. Sends an invite email containing a one-shot link to ' +
      '/accept-invite?token=... — the invitee sets their own password there.\n\n' +
      '**Only SUPER_ADMIN can call this.** Roles invitable here are ' +
      'ADMIN | OPS | CUSTOMER_SERVICE. SUPER_ADMIN cannot be invited (only ' +
      'created via the bootstrap seed).',
  })
  @ApiResponse({
    status: 201,
    description: 'Staff member created and invite email dispatched.',
    schema: {
      example: {
        user: STAFF_EXAMPLE,
        inviteToken: 'a1b2c3d4...DEV-ONLY...xyz',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error (e.g. invalid role).' })
  @ApiResponse({ status: 403, description: 'Not a SUPER_ADMIN.' })
  @ApiResponse({ status: 409, description: 'Email or phone number already registered.' })
  async invite(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreateStaffDto,
  ) {
    // The audited inviter's first/last name go into the invite email
    // ("Tunde Bello invited you to..."). Pull from DB rather than JWT so
    // changes to the SUPER_ADMIN's display name take effect immediately.
    // firstName/lastName live on Profile (PII split), so we fetch via the
    // relation and flatten the bits StaffService.invite() needs.
    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      select: {
        id: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    return this.staff.invite(
      {
        id: inviter.id,
        firstName: inviter.profile?.firstName ?? '',
        lastName: inviter.profile?.lastName ?? '',
      },
      dto,
    );
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Listed staff')
  @ApiOperation({
    summary: '(ADMIN, SUPER_ADMIN) List all staff members',
    description:
      'Paginated list of all non-USER accounts. Filter by `role` (e.g. ' +
      '`?role=OPS` for just OPS staff) and/or `status`. Soft-deleted users are ' +
      'excluded.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated staff list.',
    schema: {
      example: {
        staff: [STAFF_EXAMPLE],
        total: 6,
        page: 1,
        pageSize: 20,
      },
    },
  })
  list(
    @CurrentUser() admin: AuthenticatedUser,
    @Query() query: ListStaffQueryDto,
  ) {
    return this.staff.list(admin.id, query);
  }

  @Patch(':id/role')
  @Roles(Role.SUPER_ADMIN)
  @LogMessage('Staff role changed')
  @ApiOperation({
    summary: "(SUPER_ADMIN) Change a staff member's role",
    description:
      'Move a staff member between ADMIN ↔ OPS ↔ CUSTOMER_SERVICE.\n\n' +
      'Refused if:\n' +
      '- Target is yourself (self-protection)\n' +
      '- Target is a SUPER_ADMIN (that role is locked from in-app changes)\n' +
      '- Target is a regular USER (use the invite endpoint to make them staff)\n' +
      '- New role is SUPER_ADMIN or USER (rejected at DTO + service layers)\n\n' +
      'Writes an `admin_logs` row capturing `{ fromRole, toRole, reason }`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Role updated.',
    schema: { example: { ...STAFF_EXAMPLE, role: 'ADMIN' } },
  })
  @ApiResponse({ status: 400, description: 'Cannot set role to SUPER_ADMIN/USER; or target is a USER.' })
  @ApiResponse({ status: 403, description: 'Self-promotion attempt, or target is SUPER_ADMIN.' })
  @ApiResponse({ status: 404, description: 'Staff member not found.' })
  updateRole(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStaffRoleDto,
  ) {
    return this.staff.updateRole(admin.id, id, dto);
  }
}
