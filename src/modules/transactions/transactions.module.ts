import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletsModule } from '../wallets/wallets.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [AuthModule, WalletsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService], // PayoutsModule will read transactions
})
export class TransactionsModule {}
