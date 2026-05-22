import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [AuthModule], // for JwtAuthGuard / RolesGuard dependency chain
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService], // TransactionsModule will call pickActiveWallet()
})
export class WalletsModule {}
