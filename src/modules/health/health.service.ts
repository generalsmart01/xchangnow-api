import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  getStatus() {
    return {
      status: 'ok',
      service: 'xchangenow-api',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
