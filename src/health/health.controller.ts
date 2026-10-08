import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { ReadinessRegistry } from './readiness-registry.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Controller()
/* v8 ignore stop */
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly readiness: ReadinessRegistry,
  ) {}

  // Liveness: 200 while the process serves HTTP. It checks no dependency, so
  // an outage of Postgres or Redis never makes Kubernetes restart the pod.
  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  // Readiness: 200 while every registered check is up, 503 otherwise. Each
  // infra module registers its own check with @ReadinessCheck.
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check(this.readiness.checks());
  }
}
