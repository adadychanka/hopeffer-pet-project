import { randomUUID } from 'node:crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Cache } from 'cache-manager';
import {
  READINESS_TIMEOUT_MS,
  ReadinessCheck,
  type ReadinessIndicator,
} from '../health/readiness.js';

// The probe key expires on its own, so probes never pile up in Redis.
const PROBE_TTL_MS = 10_000;

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@ReadinessCheck('redis')
@Injectable()
/* v8 ignore stop */
export class RedisCacheHealthIndicator implements ReadinessIndicator {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly indicator: HealthIndicatorService,
  ) {}

  // Writes a value and reads it back through the client the app uses. Keyv
  // reports some store errors as a missing value instead of throwing, so the
  // check compares what it reads with what it wrote.
  isHealthy(key: string) {
    return this.indicator
      .check(key)
      .attempt(async () => {
        const probeKey = `health:${randomUUID()}`;
        const value = randomUUID();
        await this.cache.set(probeKey, value, PROBE_TTL_MS);
        if ((await this.cache.get<string>(probeKey)) !== value) {
          throw new Error('Redis did not return the value just written');
        }
      })
      .withTimeout(READINESS_TIMEOUT_MS);
  }
}
