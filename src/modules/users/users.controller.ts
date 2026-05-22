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

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard) // all routes require JWT; RolesGuard only enforces if @Roles is set
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ----------------------------- self-service -----------------------------

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findById(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.updateProfile(user.id, dto);
  }

  @Get('me/bank-accounts')
  listBankAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listBankAccounts(user.id);
  }

  @Post('me/bank-accounts')
  addBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.users.createBankAccount(user.id, dto);
  }

  @Patch('me/bank-accounts/:id')
  updateBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.users.updateBankAccount(user.id, id, dto);
  }

  @Delete('me/bank-accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.users.deleteBankAccount(user.id, id);
  }

  // -------------------------------- admin --------------------------------

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  listAll(@Query() query: ListUsersQueryDto) {
    return this.users.listUsers(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  getById(@Param('id') id: string) {
    return this.users.findByIdAsAdmin(id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  updateStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserStatusDto,
  ) {
    return this.users.updateUserStatus(admin.id, id, dto);
  }
}
