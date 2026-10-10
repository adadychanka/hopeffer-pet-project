import type { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env.js';

export function loggerOptions(
  config: ConfigService<Env, true>,
  isTTY = Boolean(process.stdout.isTTY),
): Params {
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const level =
    config.get('LOG_LEVEL', { infer: true }) ??
    (nodeEnv === 'test' ? 'silent' : 'info');

  // Pretty output only for a developer terminal. Containers and CI get JSON lines.
  const pretty = isTTY && nodeEnv !== 'production';

  return {
    pinoHttp: {
      level,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      // Without pretty output there is no transport: Pino then writes straight
      // to stdout, synchronously and without a worker thread.
      transport: pretty
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
    },
  };
}
