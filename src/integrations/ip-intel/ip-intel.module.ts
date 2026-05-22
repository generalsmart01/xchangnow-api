import { Module } from '@nestjs/common';
import { IpIntelService } from './ip-intel.service';

@Module({
  providers: [IpIntelService],
  exports: [IpIntelService],
})
export class IpIntelModule {}
