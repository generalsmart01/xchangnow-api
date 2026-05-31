// src/modules/bank-accounts/bank-accounts.controller.ts

/**
 * ─── Endpoints ──────────────────────────────────────────────────────────────
 *
 *   GET    /bank-accounts/me        JWT
 *                                   200: BankAccount[] (default first)
 *
 *   POST   /bank-accounts/me        JWT, body: CreateBankAccountDto
 *                                   201: BankAccount
 *                                   409: duplicate (bank + account_number)
 *
 *   PATCH  /bank-accounts/me/:id    JWT, body: UpdateBankAccountDto
 *                                   200: updated BankAccount
 *                                   404: not found / not yours
 *
 *   DELETE /bank-accounts/me/:id    JWT
 *                                   204
 *                                   409: bank account has payouts attached
 *                                   404: not found / not yours
 *
 * All routes scoped to the authenticated caller. Admin reads of OTHER users'
 * bank accounts are intentionally NOT exposed here yet — the only admin
 * surface is the masked embed inside PayoutsService.findByIdAsAdmin.
 *
 * Bank accounts are financial PII (rulebook §25 tier 3). All responses on
 * this controller return full account numbers because the caller is reading
 * their OWN data. Cross-user admin reads (when added) must mask.
 */

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
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

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

@ApiTags('Bank Accounts')
@ApiBearerAuth('JWT-auth')
@Controller('bank-accounts')
@UseGuards(JwtAuthGuard)
export class BankAccountsController {
  constructor(private readonly bankAccounts: BankAccountsService) {}

  @Get('me')
  @LogMessage('Listed bank accounts')
  @ApiOperation({
    summary: 'List my bank accounts',
    description:
      'Returns all bank accounts owned by the current user, default first ' +
      'then oldest first within the rest.',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of bank accounts.',
    schema: { example: [BANK_ACCOUNT_EXAMPLE] },
  })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.bankAccounts.listMine(user.id);
  }

  @Post('me')
  @LogMessage('Bank account added')
  @ApiOperation({
    summary: 'Add a bank account',
    description:
      'Creates a bank account for the current user. If `isDefault=true`, ' +
      'any previously-default account is auto-unset (atomic, in a ' +
      'transaction). A SELL transaction cannot be created without at least ' +
      "one default bank account — it's where the payout will be sent.",
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
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.bankAccounts.create(user.id, dto);
  }

  @Patch('me/:id')
  @LogMessage('Bank account updated')
  @ApiOperation({
    summary: 'Update one of my bank accounts',
    description:
      'Updates the named fields. Setting `isDefault=true` makes this the ' +
      'new default and unsets the previous default in the same transaction.',
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
      "avoid leaking existence of other users' accounts).",
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.bankAccounts.update(user.id, id, dto);
  }

  @Delete('me/:id')
  @LogMessage('Bank account deleted')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a bank account',
    description:
      'Hard delete. Refused (409) if any payouts reference this account — ' +
      "we don't orphan payout history. Wait for outstanding payouts to " +
      'settle, then retry.',
  })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({
    status: 409,
    description: 'Bank account has payouts attached and cannot be deleted.',
  })
  @ApiResponse({ status: 404, description: 'Not found / not yours.' })
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.bankAccounts.delete(user.id, id);
  }
}
