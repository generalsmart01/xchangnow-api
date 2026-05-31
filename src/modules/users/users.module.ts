// src/modules/users/users.module.ts

/**
 * UsersModule — owns the User + Profile surface for both self-service
 * (the authenticated user managing their own data) and admin operations
 * (listing/searching users, suspending/anonymizing).
 *
 * Bank accounts live in their own module (BankAccountsModule). They are
 * financial PII (rulebook §25 tier 3) with different masking + audit
 * requirements; keeping them separate from this profile-PII surface keeps
 * each module's invariants clear. UsersService never touches bank_accounts
 * via CRUD; the anonymization flow DOES scrub them — but as a one-shot
 * operation inside a single $transaction, not via cross-module service calls.
 *
 * Provides:
 *   - UsersService (exported)
 *   - AnonymizationService (NOT exported — only UsersController uses it
 *     internally via POST /users/:id/anonymize). Owns the right-to-be-
 *     forgotten flow: atomic scrub across User+Profile+BankAccount with
 *     session revocation, token deletion, security_log, admin_log, and
 *     pii_access_log writes. Kept as a separate service from UsersService
 *     because the blast radius of an anonymization is too big to bury
 *     inside the regular UsersService surface where a typo is dangerous.
 *
 * Imports:
 *   - AuthModule — needed for JwtAuthGuard / RolesGuard at the DI level.
 *     Importing the module brings their providers into scope; the guards
 *     are still attached per-route via @UseGuards.
 *
 * PII access logging (PiiAccessLogService from the global PiiModule) is
 * threaded through admin reads + the anonymization flow — see users.service
 * and anonymization.service for the audit points.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnonymizationService } from './anonymization.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, AnonymizationService],
  exports: [UsersService],
})
export class UsersModule {}
