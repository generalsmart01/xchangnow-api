// src/modules/networks/networks.module.ts

/**
 * NetworksModule — CRUD over the dynamic Network reference table.
 *
 * Exports NetworksService so AssetsService can validate that a referenced
 * networkId exists + is enabled before creating an AssetNetwork pair.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NetworksController } from './networks.controller';
import { NetworksService } from './networks.service';

@Module({
  imports: [AuthModule],
  controllers: [NetworksController],
  providers: [NetworksService],
  exports: [NetworksService],
})
export class NetworksModule {}
