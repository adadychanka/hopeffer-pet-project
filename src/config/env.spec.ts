import { describe, expect, it } from 'vitest';
import { envSchema, validateEnv, validateMigrationEnv } from './env.js';

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
    expect(validateEnv(validEnv)).toEqual({ ...validEnv, PORT: 3000 });
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

    expect(validateEnv(withoutS3)).toEqual({ ...withoutS3, PORT: 3000 });
  });

  it('rejects input that is not an object without throwing', () => {
    expect(envSchema.safeParse(null).success).toBe(false);
  });

  it('treats an empty value as unset', () => {
    const env = validateEnv({
      ...validEnv,
      S3_ENDPOINT: '',
      S3_ACCESS_KEY: '',
      S3_SECRET_KEY: '',
      PORT: '',
    });

    expect(env).not.toHaveProperty('S3_ENDPOINT');
    expect(env).not.toHaveProperty('S3_ACCESS_KEY');
    expect(env.PORT).toBe(3000);
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: '' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('keeps the OpenSearch credentials and CA certificate', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';

    expect(
      validateEnv({
        ...validEnv,
        OPENSEARCH_USERNAME: 'admin',
        OPENSEARCH_PASSWORD: 'secret',
        OPENSEARCH_CA_CERT: pem,
      }),
    ).toMatchObject({
      OPENSEARCH_USERNAME: 'admin',
      OPENSEARCH_PASSWORD: 'secret',
      OPENSEARCH_CA_CERT: pem,
    });
  });

  it('turns \\n in a one-line OPENSEARCH_CA_CERT into line breaks', () => {
    const env = validateEnv({
      ...validEnv,
      OPENSEARCH_CA_CERT:
        '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----',
    });

    expect(env.OPENSEARCH_CA_CERT).toBe(
      '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    );
  });

  it('rejects an OPENSEARCH_CA_CERT that is not PEM text', () => {
    expect(() =>
      validateEnv({ ...validEnv, OPENSEARCH_CA_CERT: '/etc/ssl/ca.pem' }),
    ).toThrow(/Expected PEM text, not a file path[\s\S]*OPENSEARCH_CA_CERT/);
  });

  it('reports a half credential pair together with other invalid settings', () => {
    const { DATABASE_URL: _, ...withoutDatabase } = validEnv;

    expect(() =>
      validateEnv({ ...withoutDatabase, S3_SECRET_KEY: undefined }),
    ).toThrow(/DATABASE_URL[\s\S]*Set S3_ACCESS_KEY and S3_SECRET_KEY/);
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
