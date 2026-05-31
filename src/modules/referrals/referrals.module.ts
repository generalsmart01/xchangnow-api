// src/modules/referrals/referrals.module.ts

/**
 * ReferralsModule — read-only surface for the referral graph + commission
 * ledger.
 *
 * Writes happen elsewhere:
 *   - Referral BINDING at registration: auth.service.register
 *   - Commission CREDIT on transaction completion:
 *     transactions.service.markCompleted (BUY/SWAP path)
 *     payouts.service.updateStatus → PAID (SELL cascade path)
 *
 * That decision is deliberate. Each write is atomic with the
 * state-machine transition that triggered it (registration, COMPLETED).
 * Extracting them into ReferralsService would mean cross-module $transaction
 * orchestration — fragile and worse for atomicity.
 *
 * Imports AuthModule for the guard dependency chain (JwtAuthGuard). All
 * routes are JWT-gated user-self reads; no admin surface here yet.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [AuthModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
})
export class ReferralsModule {}
