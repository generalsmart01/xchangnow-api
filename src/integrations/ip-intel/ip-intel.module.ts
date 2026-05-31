// src/integrations/ip-intel/ip-intel.module.ts

/**
 * IpIntelModule — IP reputation lookup integration.
 *
 * Wraps an external IP-intelligence provider (currently configurable via
 * env; defaults to a stub for local dev). Returns signals like VPN /
 * proxy / Tor / datacenter / risk score that SecurityService feeds into
 * the login risk gate.
 *
 * Consumed by SecurityModule only. Not @Global — narrow surface area.
 */

import { Module } from '@nestjs/common';
import { IpIntelService } from './ip-intel.service';

@Module({
  providers: [IpIntelService],
  exports: [IpIntelService],
})
export class IpIntelModule {}
