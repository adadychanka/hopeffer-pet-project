import { describe, expect, it } from 'vitest';
import { hostname } from 'node:os';
import { Writable } from 'node:stream';
import pino from 'pino';
import { isPretty, logFormat } from './log-format.js';
import { packageInfo } from './package-info.js';

// Runs a real Pino logger with the format and returns the parsed line.
function lineWith(
  fields: Parameters<typeof logFormat>[0],
): Record<string, unknown> {
  let written = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      written += chunk.toString();
      done();
    },
  });
  pino(logFormat(fields), stream).error('boom');
  return JSON.parse(written) as Record<string, unknown>;
}

describe('logFormat', () => {
  it('writes the level as a label and the time as an ISO string', () => {
    const line = lineWith({});

    expect(line.level).toBe('error');
    expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(line.msg).toBe('boom');
  });

  it('names the service, version and environment on every line', () => {
    expect(
      lineWith({ APP_VERSION: 'abc1234', APP_ENV: 'staging' }),
    ).toMatchObject({
      service: 'hopeffer-pet-project',
      version: 'abc1234',
      env: 'staging',
      pid: process.pid,
      hostname: hostname(),
    });
  });

  it('falls back to the package.json version and to NODE_ENV', () => {
    expect(lineWith({ NODE_ENV: 'production' })).toMatchObject({
      version: packageInfo().version,
      env: 'production',
    });
    expect(lineWith({})).toMatchObject({ env: 'development' });
  });

  it('treats an empty value as unset', () => {
    expect(
      lineWith({ APP_VERSION: '', APP_ENV: '', NODE_ENV: 'production' }),
    ).toMatchObject({ version: packageInfo().version, env: 'production' });
  });
});

describe('packageInfo', () => {
  it('reads the name and a semver version from package.json', () => {
    expect(packageInfo()).toEqual({
      name: 'hopeffer-pet-project',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/) as string,
    });
  });
});

describe('isPretty', () => {
  it('is true only in a terminal outside production', () => {
    expect(isPretty('development', true)).toBe(true);
    expect(isPretty(undefined, true)).toBe(true);
    expect(isPretty('production', true)).toBe(false);
    expect(isPretty('development', false)).toBe(false);
  });
});
