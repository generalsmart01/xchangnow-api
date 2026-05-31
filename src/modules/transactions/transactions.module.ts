// src/modules/transactions/transactions.module.ts

/**
 * TransactionsModule — the core money-moving feature.
 *
 * Provides:
 *   - TransactionsService (exported — PayoutsService cascades transaction
 *     state on PAID; future modules may also read transactions)
 *
 * Imports:
 *   - AuthModule    — guards (JwtAuthGuard, RolesGuard, VerifiedGuard)
 *   - WalletsModule — pickActiveWallet() for SELL/SWAP destination wallet
 *
 * The Transaction state machine is owned here:
 *   SELL / SWAP:  PENDING → UNDER_REVIEW → APPROVED → COMPLETED
 *   BUY:          AWAITING_PAYMENT → UNDER_REVIEW → APPROVED → COMPLETED
 *   (any non-terminal status can transition to REJECTED with a reason)
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsModule } from '../wallets/wallets.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [AuthModule, WalletsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
