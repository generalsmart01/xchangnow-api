// src/modules/rates/rates.module.ts

/**
 * RatesModule — admin-driven crypto-fiat exchange rate management.
 *
 * Rates are stored as time-series snapshots — each POST creates a new row,
 * never updates an existing one. The `/current` endpoint returns the most
 * recent per asset, and TransactionsService consults rates at creation
 * time to compute the fiat side of every BUY/SELL.
 *
 * Exported for the long term: when we refactor TransactionsService away
 * from inline rate lookup, it'll import RatesService here.
 */

import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AuthModule } from '../auth/auth.module';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';

@Module({
  imports: [AuthModule, AssetsModule],
  controllers: [RatesController],
  providers: [RatesService],
  exports: [RatesService],
})
export class RatesModule {}
