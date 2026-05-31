// src/common/pii/pii.module.ts

/**
 * @Global so PiiAccessLogService is available everywhere without per-module
 * imports. Mirrors the pattern PrismaModule uses — audit services that
 * every feature might need are best exposed globally.
 */

import { Global, Module } from '@nestjs/common';
import { PiiAccessLogService } from './pii-access-log.service';

@Global()
@Module({
  providers: [PiiAccessLogService],
  exports: [PiiAccessLogService],
})
export class PiiModule {}
