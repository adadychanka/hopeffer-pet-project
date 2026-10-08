import { describe, expect, it, vi } from 'vitest';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Env } from '../config/env.js';
import { S3HealthIndicator } from './s3.health.js';
import { S3Service } from './s3.service.js';

function s3Service(): S3Service {
  return new S3Service(
    new ConfigService<Env, true>({
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: 'access',
      S3_SECRET_KEY: 'secret',
    }),
  );
}

describe('S3HealthIndicator', () => {
  it('is up when ListBuckets succeeds, and asks for one bucket only', async () => {
    const s3 = s3Service();
    const send = vi.spyOn(s3, 'send').mockResolvedValue({} as never);
    const indicator = new S3HealthIndicator(s3, new HealthIndicatorService());

    expect(await indicator.isHealthy('s3')).toMatchObject({
      s3: { status: 'up' },
    });
    const [command, options] = send.mock.calls[0] as unknown as [
      ListBucketsCommand,
      { abortSignal: AbortSignal },
    ];
    expect(command).toBeInstanceOf(ListBucketsCommand);
    expect(command.input).toEqual({ MaxBuckets: 1 });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('is down with the error message when S3 rejects the request', async () => {
    const s3 = s3Service();
    vi.spyOn(s3, 'send').mockRejectedValue(new Error('Access Denied') as never);
    const indicator = new S3HealthIndicator(s3, new HealthIndicatorService());

    expect(await indicator.isHealthy('s3')).toMatchObject({
      s3: { status: 'down', message: 'Access Denied' },
    });
  });
});
