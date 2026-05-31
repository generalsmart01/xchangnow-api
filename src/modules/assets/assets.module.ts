// src/modules/assets/assets.module.ts

/**
 * AssetsModule — dynamic Asset reference table + AssetNetwork pair management.
 *
 * Exports AssetsService so WalletsService / TransactionsService can validate
 * AssetNetworkIds before creating wallet rows or transactions.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NetworksModule } from '../networks/networks.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [AuthModule, NetworksModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
