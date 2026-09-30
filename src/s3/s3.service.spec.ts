import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { S3Service } from './s3.service.js';

describe('S3Service', () => {
  it('builds its client from the S3_* settings', async () => {
    const { config } = new S3Service(
      new ConfigService<Env, true>({
        S3_ENDPOINT: 'https://s3.internal:9500',
        S3_REGION: 'eu-central-1',
        S3_ACCESS_KEY: 'access',
        S3_SECRET_KEY: 'secret',
      }),
    );

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
});
