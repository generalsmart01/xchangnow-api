import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';

@Module({
  imports: [AuthModule], // for JwtAuthGuard / RolesGuard
  controllers: [RatesController],
  providers: [RatesService],
  exports: [RatesService], // TransactionsService can use it later if we refactor away from inline rate lookup
})
export class RatesModule {}
