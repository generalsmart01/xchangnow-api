import {
  Body,
  Controller,
  Delete,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { AdminUpdateUserStatusDto } from './dto/admin-update-user-status.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

const USER_EXAMPLE = {
  id: 'cmpgx5qjh0000o85kzmyj8zpy',
  email: 'michael@xchangenow.com',
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

const BANK_ACCOUNT_EXAMPLE = {
  id: 'cmpgx5ryo000go85kxlbxwzn7',
  userId: 'cmpgx5qjh0000o85kzmyj8zpy',
  bankName: 'Guaranty Trust Bank',
  accountNumber: '0123456789',
  accountName: 'Michael Adeleke',
  isDefault: true,
  createdAt: '2026-05-22T13:00:00.000Z',
  updatedAt: '2026-05-22T13:00:00.000Z',
};

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard) // all routes require JWT; RolesGuard only enforces if @Roles is set
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ----------------------------- self-service -----------------------------

  @Get('me')
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

  @Get('me/bank-accounts')
  @ApiOperation({
    summary: 'List my bank accounts',
    description:
      'Returns all bank accounts owned by the current user, default first ' +
      '(then oldest first within the rest).',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of bank accounts.',
    schema: { example: [BANK_ACCOUNT_EXAMPLE] },
  })
  listBankAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listBankAccounts(user.id);
  }

  @Post('me/bank-accounts')
  @ApiOperation({
    summary: 'Add a bank account',
    description:
      'Creates a bank account for the current user. If `isDefault=true`, any ' +
      'previously-default account is auto-unset (atomic, in a transaction). ' +
      'A SELL transaction cannot be created without at least one default ' +
      'bank account — it\'s where the payout will be sent.',
  })
  @ApiResponse({
    status: 201,
    description: 'Bank account created.',
    schema: { example: BANK_ACCOUNT_EXAMPLE },
  })
  @ApiResponse({
    status: 409,
    description: 'You already have a bank account with this bank + account number.',
  })
  addBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.users.createBankAccount(user.id, dto);
  }

  @Patch('me/bank-accounts/:id')
  @ApiOperation({
    summary: 'Update one of my bank accounts',
    description:
      'Updates the named fields. Setting `isDefault=true` makes this the new ' +
      'default and unsets the previous default in the same transaction.',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated bank account.',
    schema: { example: BANK_ACCOUNT_EXAMPLE },
  })
  @ApiResponse({
    status: 404,
    description:
      'Bank account not found OR not owned by you (same 404 either way to ' +
      'avoid leaking existence of other users\' accounts).',
  })
  updateBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.users.updateBankAccount(user.id, id, dto);
  }

  @Delete('me/bank-accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a bank account',
    description:
      'Hard delete. Refused (409) if any payouts reference this account — ' +
      'we don\'t orphan payout history. Mark inactive on user-side instead, ' +
      'or wait for outstanding payouts to settle.',
  })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({
    status: 409,
    description: 'Bank account has payouts attached and cannot be deleted.',
  })
  @ApiResponse({ status: 404, description: 'Not found / not yours.' })
  removeBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.users.deleteBankAccount(user.id, id);
  }

  // -------------------------------- admin --------------------------------

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
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
  listAll(@Query() query: ListUsersQueryDto) {
    return this.users.listUsers(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: '(Admin) Get a user by id',
    description: 'Returns the full user record. Includes soft-deleted users.',
  })
  @ApiResponse({ status: 200, schema: { example: USER_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'User not found.' })
  getById(@Param('id') id: string) {
    return this.users.findByIdAsAdmin(id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
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
}
