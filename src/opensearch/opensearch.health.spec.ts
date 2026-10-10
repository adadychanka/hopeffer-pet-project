import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { Env } from '../config/env.js';
import { READINESS_TIMEOUT_MS } from '../health/readiness.js';
import { OpensearchHealthIndicator } from './opensearch.health.js';
import { OpensearchService } from './opensearch.service.js';

function opensearchService(): OpensearchService {
  return new OpensearchService(
    new ConfigService<Env, true>({ OPENSEARCH_NODE: 'http://localhost:9200' }),
  );
}

describe('OpensearchHealthIndicator', () => {
  it('is up when ping answers true, with no retries and the readiness timeout', async () => {
    const opensearch = opensearchService();
    const ping = vi
      .spyOn(opensearch, 'ping')
      .mockResolvedValue({ body: true } as never);
    const indicator = new OpensearchHealthIndicator(
      opensearch,
      new HealthIndicatorService(),
    );

    expect(await indicator.isHealthy('opensearch')).toMatchObject({
      opensearch: { status: 'up' },
    });
    expect(ping).toHaveBeenCalledWith(
      {},
      { requestTimeout: READINESS_TIMEOUT_MS, maxRetries: 0 },
    );
  });

  it('is down when ping answers false', async () => {
    const opensearch = opensearchService();
    vi.spyOn(opensearch, 'ping').mockResolvedValue({ body: false } as never);
    const indicator = new OpensearchHealthIndicator(
      opensearch,
      new HealthIndicatorService(),
    );

    expect(await indicator.isHealthy('opensearch')).toMatchObject({
      opensearch: { status: 'down', message: 'OpenSearch ping failed' },
    });
  });

  it('is down with the error message when ping throws', async () => {
    const opensearch = opensearchService();
    vi.spyOn(opensearch, 'ping').mockRejectedValue(
      new Error('connect ECONNREFUSED'),
    );
    const indicator = new OpensearchHealthIndicator(
      opensearch,
      new HealthIndicatorService(),
    );

    expect(await indicator.isHealthy('opensearch')).toMatchObject({
      opensearch: { status: 'down', message: 'connect ECONNREFUSED' },
    });
  });
});
