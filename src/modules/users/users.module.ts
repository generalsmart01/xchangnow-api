import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule], // for JwtAuthGuard / RolesGuard dependencies
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // future modules (transactions, payouts) will need it
})
export class UsersModule {}
