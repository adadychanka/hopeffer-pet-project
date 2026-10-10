import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import {
  READINESS_TIMEOUT_MS,
  ReadinessCheck,
  type ReadinessIndicator,
} from '../health/readiness.js';
import { OpensearchService } from './opensearch.service.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@ReadinessCheck('opensearch')
@Injectable()
/* v8 ignore stop */
export class OpensearchHealthIndicator implements ReadinessIndicator {
  constructor(
    private readonly opensearch: OpensearchService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  // ping() sends HEAD / and resolves false on some error statuses instead of
  // throwing. No retries: the probe asks again on its own schedule.
  isHealthy(key: string) {
    return this.indicator
      .check(key)
      .attempt(async () => {
        const { body } = await this.opensearch.ping(
          {},
          { requestTimeout: READINESS_TIMEOUT_MS, maxRetries: 0 },
        );
        if (!body) {
          throw new Error('OpenSearch ping failed');
        }
      })
      .withTimeout(READINESS_TIMEOUT_MS);
  }
}
