// src/modules/payouts/payouts.module.ts

/**
 * PayoutsModule — drives the lifecycle of fiat payouts to user bank accounts.
 *
 * Payouts are created automatically when a SELL transaction is APPROVED
 * (see TransactionsService.approve). This module owns their subsequent
 * state transitions: PENDING → PROCESSING → PAID (or FAILED → retry).
 *
 * When a payout reaches PAID, this module ALSO cascades the parent
 * Transaction to COMPLETED — direct DB write to avoid a circular module
 * dependency with TransactionsModule.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [AuthModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
