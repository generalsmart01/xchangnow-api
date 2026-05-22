import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness check',
    description:
      'Returns process status + uptime. No authentication required. ' +
      'Use this for load-balancer health probes, Kubernetes liveness/readiness, ' +
      'or as a "is the API up?" smoke test from clients.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is alive.',
    schema: {
      example: {
        status: 'ok',
        service: 'xchangenow-api',
        uptimeSeconds: 1342,
        timestamp: '2026-05-22T14:30:00.000Z',
      },
    },
  })
  check() {
    return this.healthService.getStatus();
  }
}
