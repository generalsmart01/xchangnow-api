// src/modules/security/security.module.ts

/**
 * SecurityModule — pre-auth risk evaluation and policy decisions.
 *
 * Provides SecurityService (exported, consumed by AuthService at login).
 *
 * RiskService is an internal collaborator — NOT exported. SecurityService
 * is the single public surface. Everything inside the module's risk
 * evaluation pipeline (IP scoring, brute-force counting, VPN/proxy/Tor
 * detection) is hidden behind that single facade so callers don't depend
 * on the internal layering.
 *
 * Depends on IpIntelModule (external IP-reputation provider integration).
 */

import { Module } from '@nestjs/common';
import { IpIntelModule } from '../../integrations/ip-intel/ip-intel.module';
import { RiskService } from './risk.service';
import { SecurityService } from './security.service';

@Module({
  imports: [IpIntelModule],
  providers: [SecurityService, RiskService],
  exports: [SecurityService],
})
export class SecurityModule {}
