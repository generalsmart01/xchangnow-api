import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule], // needed so JwtAuthGuard / RolesGuard can resolve their deps
  controllers: [AdminController],
})
export class AdminModule {}
