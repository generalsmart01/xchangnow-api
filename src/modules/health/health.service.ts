// src/modules/health/health.service.ts

/**
 * HealthService — returns the process-level liveness payload.
 *
 * `uptimeSeconds` is computed from process start (captured in the
 * constructor) rather than Node's `process.uptime()` — they're equivalent
 * in practice but the in-class field is slightly faster and tied to the
 * Nest application's actual lifecycle.
 */

import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  getStatus() {
    return {
      status: 'ok',
      service: 'xchangnow-api',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
