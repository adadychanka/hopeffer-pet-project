import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'minio';
import { MinioService } from './minio.service.js';

vi.mock('minio', () => ({ Client: vi.fn() }));

describe('MinioService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.mocked(Client).mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds its client from the MINIO_* env vars', () => {
    process.env.MINIO_ENDPOINT = 'minio.internal';
    process.env.MINIO_PORT = '9500';
    process.env.MINIO_USE_SSL = 'true';
    process.env.MINIO_ACCESS_KEY = 'access';
    process.env.MINIO_SECRET_KEY = 'secret';

    new MinioService();

    expect(Client).toHaveBeenCalledWith({
      endPoint: 'minio.internal',
      port: 9500,
      useSSL: true,
      accessKey: 'access',
      secretKey: 'secret',
    });
  });

  it('falls back to local defaults when MINIO_* env vars are unset', () => {
    delete process.env.MINIO_ENDPOINT;
    delete process.env.MINIO_PORT;
    delete process.env.MINIO_USE_SSL;
    delete process.env.MINIO_ACCESS_KEY;
    delete process.env.MINIO_SECRET_KEY;

    new MinioService();

    expect(Client).toHaveBeenCalledWith({
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: '',
      secretKey: '',
    });
  });
});
