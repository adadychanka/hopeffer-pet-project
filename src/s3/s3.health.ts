import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import {
  READINESS_TIMEOUT_MS,
  ReadinessCheck,
  type ReadinessIndicator,
} from '../health/readiness.js';
import { S3Service } from './s3.service.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@ReadinessCheck('s3')
@Injectable()
/* v8 ignore stop */
export class S3HealthIndicator implements ReadinessIndicator {
  constructor(
    private readonly s3: S3Service,
    private readonly indicator: HealthIndicatorService,
  ) {}

  // ListBuckets proves that the endpoint answers and accepts the credentials.
  // No bucket name is configured yet; switch to HeadBucket when one is. On
  // AWS, the role needs s3:ListAllMyBuckets.
  isHealthy(key: string) {
    return this.indicator
      .check(key)
      .attempt(async ({ signal }) => {
        await this.s3.send(new ListBucketsCommand({ MaxBuckets: 1 }), {
          abortSignal: signal,
        });
      })
      .withTimeout(READINESS_TIMEOUT_MS);
  }
}
