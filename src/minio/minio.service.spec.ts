import { afterEach, describe, expect, it } from 'vitest';
import { MinioService } from './minio.service.js';

describe('MinioService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds its client from the MINIO_* env vars', () => {
    process.env.MINIO_ENDPOINT = 'minio.internal';
    process.env.MINIO_PORT = '9500';
    process.env.MINIO_USE_SSL = 'true';
    process.env.MINIO_ACCESS_KEY = 'access';
    process.env.MINIO_SECRET_KEY = 'secret';

    const service = new MinioService();

    expect(service.host).toBe('minio.internal');
    expect(service.port).toBe(9500);
    expect(service.protocol).toBe('https:');
    expect(service.accessKey).toBe('access');
    expect(service.secretKey).toBe('secret');
  });

  it('falls back to local defaults when MINIO_* env vars are unset', () => {
    delete process.env.MINIO_ENDPOINT;
    delete process.env.MINIO_PORT;
    delete process.env.MINIO_USE_SSL;

    const service = new MinioService();

    expect(service.host).toBe('localhost');
    expect(service.port).toBe(9000);
    expect(service.protocol).toBe('http:');
  });
});
