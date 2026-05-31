// src/modules/admin/admin.module.ts

/**
 * AdminModule — operational endpoints not owned by a feature module.
 *
 * Currently three surfaces:
 *   - AdminController      /admin/ping (auth chain smoke test)
 *   - StaffController      /admin/staff/* (invite, list, change role)
 *   - BootstrapController  /admin/bootstrap (one-time SUPER_ADMIN mint —
 *                          PUBLIC, secret-gated, single-use)
 *
 * Other "admin" operations live on their feature modules — for example,
 * admin transaction approval is on TransactionsModule, admin user
 * suspension is on UsersModule. Only meta-admin concerns belong here.
 *
 * StaffService imports:
 *   - AuthService    for AuthService.issueInviteToken (shared invite plumbing)
 *   - EmailService   for EmailService.sendInviteEmail
 *   - PiiAccessLog   global; audits staff invitation as PROFILE CREATE
 *
 * BootstrapService is intentionally NOT exported — it's only consumed by
 * BootstrapController, and the whole flow is single-use by design.
 */

import { Module } from '@nestjs/common';
import { EmailModule } from '../../integrations/email/email.module';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [
    AuthModule,
    EmailModule,
  ],
  controllers: [AdminController, StaffController, BootstrapController],
  providers: [StaffService, BootstrapService],
})
export class AdminModule {}
