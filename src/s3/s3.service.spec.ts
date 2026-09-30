import { afterEach, describe, expect, it } from 'vitest';
import { S3Service } from './s3.service.js';

describe('S3Service', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds its client from the S3_* env vars', async () => {
    process.env.S3_ENDPOINT = 'https://s3.internal:9500';
    process.env.S3_REGION = 'eu-central-1';
    process.env.S3_ACCESS_KEY = 'access';
    process.env.S3_SECRET_KEY = 'secret';

    const { config } = new S3Service();

    expect(await config.endpoint?.()).toMatchObject({
      protocol: 'https:',
      hostname: 's3.internal',
      port: 9500,
    });
    expect(await config.region()).toBe('eu-central-1');
    expect(await config.credentials()).toMatchObject({
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    });
    expect(config.forcePathStyle).toBe(true);
  });

  it('falls back to local defaults when S3_* env vars are unset', async () => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;

    const { config } = new S3Service();

    expect(await config.endpoint?.()).toMatchObject({
      protocol: 'http:',
      hostname: 'localhost',
      port: 9000,
    });
    expect(await config.region()).toBe('us-east-1');
    expect(await config.credentials()).toMatchObject({
      accessKeyId: '',
      secretAccessKey: '',
    });
  });
});
