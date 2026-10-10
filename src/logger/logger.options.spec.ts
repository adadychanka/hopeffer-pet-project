import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { loggerOptions } from './logger.options.js';

// ConfigService falls back to process.env for keys it was not given, and
// Vitest sets NODE_ENV=test there, so every test sets NODE_ENV itself.
function config(env: Partial<Env>) {
  return new ConfigService<Env, true>({ NODE_ENV: 'development', ...env });
}

describe('loggerOptions', () => {
  it('writes JSON to stdout without a transport outside a terminal', () => {
    const { pinoHttp } = loggerOptions(config({}), false);

    expect(pinoHttp).toMatchObject({
      level: 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      transport: undefined,
    });
  });

  it('is silent under tests unless LOG_LEVEL is set', () => {
    expect(loggerOptions(config({ NODE_ENV: 'test' }), false)).toMatchObject({
      pinoHttp: { level: 'silent' },
    });
    expect(
      loggerOptions(config({ NODE_ENV: 'test', LOG_LEVEL: 'debug' }), false),
    ).toMatchObject({ pinoHttp: { level: 'debug' } });
  });

  it('pretty-prints in a terminal, but not in production', () => {
    expect(loggerOptions(config({}), true)).toMatchObject({
      pinoHttp: { transport: { target: 'pino-pretty' } },
    });
    expect(
      loggerOptions(config({ NODE_ENV: 'production' }), true),
    ).toMatchObject({ pinoHttp: { transport: undefined } });
  });

  it('reads the TTY state of stdout by default', () => {
    const { pinoHttp } = loggerOptions(config({ NODE_ENV: 'production' }));

    expect(pinoHttp).toMatchObject({ transport: undefined });
  });
});
