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
