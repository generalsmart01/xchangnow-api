// src/integrations/email/email.module.ts

/**
 * EmailModule — outbound email integration.
 *
 * Consumed by AuthModule (verify / reset / invite emails) and AdminModule
 * (staff invitations). Not @Global because the surface is narrow — only
 * a couple of modules ever send email, and they import explicitly.
 *
 * The actual transport (nodemailer + SMTP) is initialized inside
 * EmailService.onModuleInit. If SMTP_* env vars aren't fully set, the
 * service falls back to console-logging emails — dev-friendly default.
 */

import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
