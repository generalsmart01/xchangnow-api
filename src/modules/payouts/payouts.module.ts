import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [AuthModule], // for JwtAuthGuard / RolesGuard
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
