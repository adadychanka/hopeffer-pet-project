import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { S3Service } from './s3.service.js';

// Settings the AWS SDK reads on its own. Clear them, so the machine that runs
// the tests cannot change what the client resolves.
const sdkEnv = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_ENDPOINT_URL',
  'AWS_ENDPOINT_URL_S3',
];

describe('S3Service', () => {
  beforeEach(() => {
    for (const name of sdkEnv) vi.stubEnv(name, undefined);
    vi.stubEnv('AWS_CONFIG_FILE', '/nonexistent/aws-config');
    vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', '/nonexistent/aws-credentials');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a path-style client from the S3_* settings', async () => {
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

  it('leaves the endpoint, region and credentials to the AWS SDK when S3_* are unset', async () => {
    vi.stubEnv('AWS_REGION', 'eu-west-1');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'chain-access');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'chain-secret');

    const { config } = new S3Service(new ConfigService<Env, true>({}));

    expect(config.isCustomEndpoint).toBe(false);
    expect(config.forcePathStyle).toBe(false);
    expect(await config.region()).toBe('eu-west-1');
    expect(await config.credentials()).toMatchObject({
      accessKeyId: 'chain-access',
      secretAccessKey: 'chain-secret',
    });
  });

  it('releases its sockets when the app shuts down', () => {
    const s3 = new S3Service(new ConfigService<Env, true>({}));
    const destroy = vi.spyOn(s3, 'destroy');

    s3.onApplicationShutdown();

    expect(destroy).toHaveBeenCalledOnce();
  });
});
