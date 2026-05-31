// src/app.module.ts

/**
 * Root module — composes every feature module into the running application.
 *
 * Import order is deliberate:
 *   1. ConfigModule (global) — must come first so other modules can read env
 *   2. PrismaModule (global) — DB access for everything below
 *   3. PiiModule (global)    — audit logging for PII access
 *   4. Feature modules        — Auth first (others depend on it), then the rest
 *      in roughly the order they appear in the API surface
 *
 * Nest builds the DI graph from this composition; circular dependencies
 * between feature modules are explicitly avoided (e.g. PayoutsService
 * writes Transaction.status directly via Prisma rather than calling
 * TransactionsService, which would create a cycle).
 *
 * This module owns no controllers or providers of its own — it's purely
 * a composition root.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PiiModule } from './common/pii/pii.module';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { AdminModule } from './modules/admin/admin.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AuthModule } from './modules/auth/auth.module';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { HealthModule } from './modules/health/health.module';
import { KycModule } from './modules/kyc/kyc.module';
import { NetworksModule } from './modules/networks/networks.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { RatesModule } from './modules/rates/rates.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { UsersModule } from './modules/users/users.module';
import { WalletsModule } from './modules/wallets/wallets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    PrismaModule,
    PiiModule, // @Global — PiiAccessLogService available everywhere
    AuthModule,
    UsersModule,
    BankAccountsModule,
    NetworksModule, // dynamic blockchain reference table — must register BEFORE Assets/Wallets/Transactions consume it
    AssetsModule,   // dynamic asset reference table + asset-network pair management
    WalletsModule,
    RatesModule,
    TransactionsModule,
    PayoutsModule,
    KycModule,
    ReferralsModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
