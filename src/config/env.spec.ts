import { describe, expect, it } from 'vitest';
import { validateEnv, validateMigrationEnv } from './env.js';

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

  it('leaves the S3 endpoint and keys to the AWS SDK when they are unset', () => {
    const {
      S3_ENDPOINT: _endpoint,
      S3_ACCESS_KEY: _accessKey,
      S3_SECRET_KEY: _secretKey,
      ...withoutS3
    } = validEnv;

    expect(validateEnv(withoutS3)).toEqual({
      ...withoutS3,
      PORT: 3000,
      S3_REGION: 'us-east-1',
    });
  });

  it('keeps the OpenSearch credentials and CA certificate', () => {
    const openSearch = {
      OPENSEARCH_USERNAME: 'admin',
      OPENSEARCH_PASSWORD: 'secret',
      OPENSEARCH_CA_CERT: '-----BEGIN CERTIFICATE-----\\n...',
    };

    expect(validateEnv({ ...validEnv, ...openSearch })).toMatchObject(
      openSearch,
    );
  });

  it.each([
    ['S3_ACCESS_KEY', 'S3_SECRET_KEY', { S3_SECRET_KEY: undefined }],
    ['S3_ACCESS_KEY', 'S3_SECRET_KEY', { S3_ACCESS_KEY: undefined }],
    [
      'OPENSEARCH_USERNAME',
      'OPENSEARCH_PASSWORD',
      { OPENSEARCH_USERNAME: 'a' },
    ],
    [
      'OPENSEARCH_USERNAME',
      'OPENSEARCH_PASSWORD',
      { OPENSEARCH_PASSWORD: 'p' },
    ],
  ])('rejects %s without %s', (a, b, change) => {
    expect(() => validateEnv({ ...validEnv, ...change })).toThrow(
      `Set ${a} and ${b} together, or leave both unset`,
    );
  });
});

describe('validateMigrationEnv', () => {
  it('needs only DATABASE_URL', () => {
    expect(
      validateMigrationEnv({ DATABASE_URL: validEnv.DATABASE_URL }),
    ).toEqual({ DATABASE_URL: validEnv.DATABASE_URL });
  });

  it('names a missing or invalid DATABASE_URL', () => {
    expect(() => validateMigrationEnv({})).toThrow(
      /Invalid environment variables:[\s\S]*DATABASE_URL/,
    );
    expect(() => validateMigrationEnv({ DATABASE_URL: 'nope' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
