// src/modules/health/health.module.ts

/**
 * HealthModule — liveness/readiness check.
 *
 * Public unauthenticated endpoint. Used by load balancers, uptime
 * monitors (Render's built-in probe, status pages, etc.) to determine
 * whether the API process is alive and accepting requests.
 *
 * Intentionally cheap — does not hit the database. A liveness check that
 * depends on the DB conflates "API is up" with "DB is up", which makes it
 * useless for the orchestrator deciding whether to restart the API
 * process.
 */

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
