import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import {
  READINESS_TIMEOUT_MS,
  ReadinessCheck,
  type ReadinessIndicator,
} from '../health/readiness.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@ReadinessCheck('database')
@Injectable()
/* v8 ignore stop */
export class DatabaseHealthIndicator implements ReadinessIndicator {
  constructor(
    private readonly dataSource: DataSource,
    private readonly indicator: HealthIndicatorService,
  ) {}

  isHealthy(key: string) {
    return this.indicator
      .check(key)
      .attempt(async () => {
        await this.dataSource.query('SELECT 1');
      })
      .withTimeout(READINESS_TIMEOUT_MS);
  }
}
