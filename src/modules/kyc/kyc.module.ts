// src/modules/kyc/kyc.module.ts

/**
 * KycModule — manual KYC verification surface.
 *
 * Self-contained: provides KycService, no exports. If transactions or
 * other modules later need "is this user KYC-approved?" they can either
 * import KycModule + inject KycService, or use the KycApprovedGuard
 * (lighter — reads Profile.kycStatus directly from DB).
 *
 * Imports AuthModule for the guard dependency chain (JwtAuthGuard +
 * RolesGuard). PiiAccessLogService is available globally via @Global
 * PiiModule (no import needed).
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [AuthModule],
  controllers: [KycController],
  providers: [KycService],
})
export class KycModule {}
