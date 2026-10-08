import { describe, expect, it, vi } from 'vitest';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { DataSource } from 'typeorm';
import { READINESS_TIMEOUT_MS } from '../health/readiness.js';
import { DatabaseHealthIndicator } from './database.health.js';

function indicatorWith(query: () => Promise<unknown>) {
  const dataSource = { query: vi.fn(query) };
  const indicator = new DatabaseHealthIndicator(
    dataSource as unknown as DataSource,
    new HealthIndicatorService(),
  );
  return { indicator, dataSource };
}

describe('DatabaseHealthIndicator', () => {
  it('is up when SELECT 1 succeeds', async () => {
    const { indicator, dataSource } = indicatorWith(() =>
      Promise.resolve([{ '?column?': 1 }]),
    );

    expect(await indicator.isHealthy('database')).toMatchObject({
      database: { status: 'up' },
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('is down with the error message when the query fails', async () => {
    const { indicator } = indicatorWith(() =>
      Promise.reject(new Error('connection refused')),
    );

    expect(await indicator.isHealthy('database')).toMatchObject({
      database: { status: 'down', message: 'connection refused' },
    });
  });

  it('is down after the timeout when the database never answers', async () => {
    const { indicator } = indicatorWith(() => new Promise(() => {}));

    expect(await indicator.isHealthy('database')).toMatchObject({
      database: {
        status: 'down',
        message: `timeout of ${READINESS_TIMEOUT_MS}ms exceeded`,
      },
    });
  });
});
