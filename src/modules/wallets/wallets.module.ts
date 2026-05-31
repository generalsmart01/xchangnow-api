// src/modules/wallets/wallets.module.ts

/**
 * WalletsModule — admin-managed company wallet addresses.
 *
 * These are the addresses customers send crypto TO (SELL / SWAP from-side).
 * Not user wallets — those aren't stored anywhere; user destination
 * addresses for SWAP/BUY live ephemerally on the Transaction row.
 *
 * TransactionsService consumes `pickActiveWallet()` to choose the
 * destination at SELL/SWAP creation time.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [AuthModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
