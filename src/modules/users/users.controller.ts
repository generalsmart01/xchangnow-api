// src/modules/users/users.controller.ts

/**
 * ─── Endpoints ──────────────────────────────────────────────────────────────
 *
 *  --- Self-service (any authenticated user) ---
 *
 *   GET    /users/me                      JWT
 *                                         200: full SafeUser
 *
 *   PATCH  /users/me                      JWT, body: UpdateUserDto
 *                                         200: updated SafeUser
 *
 *  (Bank account CRUD moved to its own module — see
 *   modules/bank-accounts/bank-accounts.controller.ts for /bank-accounts/me/*)
 *
 *  --- Admin ---
 *
 *   GET    /users                         JWT + ADMIN|SUPER_ADMIN
 *                                         query: page, pageSize, status, search
 *                                         200: { users[], total, page, pageSize }
 *
 *   GET    /users/:id                     JWT + ADMIN|SUPER_ADMIN
 *                                         200: SafeUser
 *                                         404: user not found
 *                                         (PiiAccessLog: PROFILE READ)
 *
 *   PATCH  /users/:id/status              JWT + ADMIN|SUPER_ADMIN,
 *                                         body: AdminUpdateUserStatusDto
 *                                         200: updated SafeUser
 *                                         403: admin tried to deactivate self
 *                                         404: user not found
 *                                         (PiiAccessLog: USER UPDATE)
 *
 *   POST   /users/:id/anonymize           JWT + ADMIN|SUPER_ADMIN,
 *                                         body: AnonymizeUserDto
 *                                         200: { message, anonymizedAt }
 *                                         403: self / SUPER_ADMIN / wrong email
 *                                         404: user not found
 *                                         409: user already anonymized
 *                                         (right-to-be-forgotten flow; scrubs
 *                                         PII across User+Profile+BankAccount,
 *                                         preserves audit + transaction history.
 *                                         PiiAccessLog: PROFILE ANONYMIZE,
 *                                         SecurityLog: HIGH severity)
 *
 * All responses wrapped by ResponseInterceptor into the standard envelope.
 * Self-service routes scope to req.user.id; admin routes accept :id but
 * RolesGuard enforces ADMIN|SUPER_ADMIN.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { AdminUpdateUserStatusDto } from './dto/admin-update-user-status.dto';
import { AnonymizeUserDto } from './dto/anonymize-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AnonymizationService } from './anonymization.service';
import { UsersService } from './users.service';

const USER_EXAMPLE = {
  id: 'cmpgx5qjh0000o85kzmyj8zpy',
  email: 'michael@xchangnow.com',
  phoneNumber: '+2348012345678',
  firstName: 'Michael',
  lastName: 'Adeleke',
  role: 'USER',
  status: 'ACTIVE',
  isEmailVerified: true,
  lastLoginAt: '2026-05-22T14:30:00.000Z',
  lastLoginIp: '203.0.113.45',
  createdAt: '2026-05-22T13:00:00.000Z',
  updatedAt: '2026-05-22T14:30:00.000Z',
  deletedAt: null,
};

/**
 * UsersController — the self-service + admin surface for User + Profile.
 *
 * Two route shapes coexist:
 *   - `/users/me/...`  → operate on the authenticated caller (any role)
 *   - `/users/:id/...` → admin-only operations on arbitrary users
 *
 * The controller-level @UseGuards installs both JwtAuthGuard (always on) +
 * RolesGuard (only enforces when @Roles is set on a route). The admin
 * routes add @Roles(ADMIN, SUPER_ADMIN) per-handler.
 *
 * Bank account CRUD moved out of this controller into BankAccountsController
 * (financial PII tier — own module, own routes at /bank-accounts/me/*).
 */
@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard) // all routes require JWT; RolesGuard only enforces if @Roles is set
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly anonymization: AnonymizationService,
  ) {}

  // ----------------------------- self-service -----------------------------

  @Get('me')
  @LogMessage('Fetched profile')
  @ApiOperation({
    summary: 'Get my full profile',
    description:
      'Returns the full user record (without `passwordHash`) for the user ' +
      'identified by the access token. Use this rather than /auth/me when you ' +
      'need fields like `status`, `phoneNumber`, `lastLoginAt`.',
  })
  @ApiResponse({ status: 200, description: 'Profile.', schema: { example: USER_EXAMPLE } })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findById(user.id);
  }

  @Patch('me')
  @LogMessage('Profile updated')
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Updates `fullName` and/or `phoneNumber`. Both fields are optional — ' +
      'omit anything you don\'t want to change. Email changes are a separate ' +
      '(future) flow that requires re-verification.',
  })
  @ApiResponse({ status: 200, description: 'Updated profile.', schema: { example: USER_EXAMPLE } })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.updateProfile(user.id, dto);
  }

  // Bank account CRUD lives in modules/bank-accounts now —
  // GET    /bank-accounts/me
  // POST   /bank-accounts/me
  // PATCH  /bank-accounts/me/:id
  // DELETE /bank-accounts/me/:id

  // -------------------------------- admin --------------------------------

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Listed users (admin)')
  @ApiOperation({
    summary: '(Admin) List users',
    description:
      'Paginated list of users. Filter by `status`, search by email/fullName. ' +
      'Soft-deleted users (`deletedAt != null`) are excluded.',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated user list.',
    schema: {
      example: {
        users: [USER_EXAMPLE],
        total: 42,
        page: 1,
        pageSize: 20,
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Not an admin.' })
  listAll(
    @CurrentUser() admin: AuthenticatedUser,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.users.listUsers(admin.id, query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('Fetched user (admin)')
  @ApiOperation({
    summary: '(Admin) Get a user by id',
    description: 'Returns the full user record. Includes soft-deleted users.',
  })
  @ApiResponse({ status: 200, schema: { example: USER_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'User not found.' })
  getById(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.users.findByIdAsAdmin(admin.id, id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('User status changed (admin)')
  @ApiOperation({
    summary: '(Admin) Change a user\'s status',
    description:
      'Update a user to ACTIVE / SUSPENDED / PENDING_VERIFICATION / DEACTIVATED. ' +
      'Admins cannot lock themselves out (deactivating yourself returns 403). ' +
      'A `user_activity_log` row is written with `action=STATUS_CHANGED` ' +
      'capturing { by, newStatus, reason }.',
  })
  @ApiResponse({ status: 200, description: 'Updated user.', schema: { example: USER_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Admin tried to suspend themselves.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  updateStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserStatusDto,
  ) {
    return this.users.updateUserStatus(admin.id, id, dto);
  }

  @Post(':id/anonymize')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @LogMessage('User anonymized (admin)')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(Admin) Anonymize a user's PII (right-to-be-forgotten)",
    description:
      "Irreversible. Atomically scrubs the user's PII across User, " +
      'Profile, and BankAccount tables; revokes all sessions; deletes ' +
      'outstanding verification/reset/invite tokens. Transactions, ' +
      'payouts, and audit logs are PRESERVED — that\'s the whole reason ' +
      "we anonymize rather than hard-delete.\n\n" +
      'Body must include `confirmEmail` matching the target user\'s ' +
      'current email (case-insensitive). This is a guard against ' +
      'fat-fingering the wrong user id. The `reason` is mandatory and ' +
      'recorded in security_logs (HIGH severity) + admin_logs.\n\n' +
      'Refused for:\n' +
      '- Self-anonymization (403)\n' +
      '- SUPER_ADMIN target (403)\n' +
      '- Already-anonymized user (409)\n' +
      '- confirmEmail mismatch (403)\n' +
      '- User not found (404)',
  })
  @ApiResponse({
    status: 200,
    description: 'User anonymized.',
    schema: {
      example: {
        message: 'User anonymized',
        anonymizedAt: '2026-05-28T14:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description:
      'Self-anonymization attempt, SUPER_ADMIN target, or confirmEmail mismatch.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 409, description: 'User is already anonymized.' })
  async anonymize(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AnonymizeUserDto,
  ): Promise<{ message: string; anonymizedAt: Date }> {
    const { anonymizedAt } = await this.anonymization.anonymizeUser(
      admin.id,
      id,
      dto.confirmEmail,
      dto.reason,
    );
    return { message: 'User anonymized', anonymizedAt };
  }
}
