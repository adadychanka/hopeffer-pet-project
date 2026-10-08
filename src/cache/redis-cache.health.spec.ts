import { describe, expect, it, vi } from 'vitest';
import { HealthIndicatorService } from '@nestjs/terminus';
import { createCache } from 'cache-manager';
import { RedisCacheHealthIndicator } from './redis-cache.health.js';

describe('RedisCacheHealthIndicator', () => {
  it('is up when a value written to the cache reads back', async () => {
    const cache = createCache();
    const set = vi.spyOn(cache, 'set');
    const indicator = new RedisCacheHealthIndicator(
      cache,
      new HealthIndicatorService(),
    );

    expect(await indicator.isHealthy('redis')).toMatchObject({
      redis: { status: 'up' },
    });
    // The probe key expires, so probes do not pile up in Redis.
    expect(set).toHaveBeenCalledWith(
      expect.stringMatching(/^health:/),
      expect.any(String),
      10_000,
    );
  });

  it('is down when the cache returns nothing for the value just written', async () => {
    // Keyv reports some store errors this way instead of throwing.
    const cache = createCache();
    vi.spyOn(cache, 'get').mockResolvedValue(undefined);
    const indicator = new RedisCacheHealthIndicator(
      cache,
      new HealthIndicatorService(),
    );

    expect(await indicator.isHealthy('redis')).toMatchObject({
      redis: {
        status: 'down',
        message: 'Redis did not return the value just written',
      },
    });
  });

  it('is down with the error message when the write fails', async () => {
    const cache = createCache();
    vi.spyOn(cache, 'set').mockRejectedValue(new Error('ECONNREFUSED'));
    const indicator = new RedisCacheHealthIndicator(
      cache,
      new HealthIndicatorService(),
    );

    expect(await indicator.isHealthy('redis')).toMatchObject({
      redis: { status: 'down', message: 'ECONNREFUSED' },
    });
  });
});
