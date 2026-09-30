import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
  OPENSEARCH_NODE: 'http://localhost:9200',
};

describe('validateEnv', () => {
  it('accepts a complete environment and fills in the defaults', () => {
    expect(validateEnv(validEnv)).toEqual({
      ...validEnv,
      PORT: 3000,
      S3_REGION: 'us-east-1',
    });
  });

  it('parses PORT as a number and keeps optional settings', () => {
    const env = validateEnv({
      ...validEnv,
      PORT: '8080',
      LOG_LEVEL: 'debug',
      LOG_FILE: 'logs/app',
    });

    expect(env).toMatchObject({
      PORT: 8080,
      LOG_LEVEL: 'debug',
      LOG_FILE: 'logs/app',
    });
  });

  it('ignores env vars the app does not use', () => {
    expect(validateEnv({ ...validEnv, HOME: '/home/me' })).not.toHaveProperty(
      'HOME',
    );
  });

  it('names every missing or invalid variable', () => {
    const { DATABASE_URL: _, ...withoutDatabase } = validEnv;

    expect(() =>
      validateEnv({ ...withoutDatabase, REDIS_URL: 'not a url', PORT: '0' }),
    ).toThrow(
      /Invalid environment variables:[\s\S]*DATABASE_URL[\s\S]*REDIS_URL/,
    );
    expect(() => validateEnv({ ...validEnv, PORT: '0' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...validEnv, LOG_LEVEL: 'loud' })).toThrow(
      /LOG_LEVEL/,
    );
  });
});
