// src/modules/bank-accounts/bank-accounts.module.ts

/**
 * BankAccountsModule — caller-scoped CRUD over bank accounts.
 *
 * Self-contained: provides BankAccountsService, no exports. Other modules
 * that need bank account data today (TransactionsService.createSell looks
 * up the default bank account; PayoutsService joins via FK) read directly
 * via Prisma rather than going through this service — same pattern used
 * across the codebase to avoid cross-module service dependencies for
 * simple reads.
 *
 * Imports AuthModule for the JwtAuthGuard dependency chain (passed through
 * @UseGuards on the controller).
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';

@Module({
  imports: [AuthModule],
  controllers: [BankAccountsController],
  providers: [BankAccountsService],
})
export class BankAccountsModule {}
