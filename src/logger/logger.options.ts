import type { ConfigService } from '@nestjs/config';
import type { Options } from 'pino-http';
import type { Env } from '../config/env.js';
import { isPretty, logFormat } from './log-format.js';
import { requestId } from './request-id.js';
import { requestLogLevel } from './request-log-level.js';

export function loggerOptions(
  config: ConfigService<Env, true>,
  isTTY = Boolean(process.stdout.isTTY),
): { pinoHttp: Options } {
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const level =
    config.get('LOG_LEVEL', { infer: true }) ??
    (nodeEnv === 'test' ? 'silent' : 'info');

  return {
    pinoHttp: {
      level,
      ...logFormat({
        APP_VERSION: config.get('APP_VERSION', { infer: true }),
        APP_ENV: config.get('APP_ENV', { infer: true }),
        NODE_ENV: nodeEnv,
      }),
      genReqId: requestId,
      // Logs made while a request runs carry only `reqId`. The full `req`
      // object is on the "request completed" line.
      quietReqLogger: true,
      customLogLevel: requestLogLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      // Without pretty output there is no transport: Pino then writes straight
      // to stdout, synchronously and without a worker thread.
      transport: isPretty(nodeEnv, isTTY)
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              ignore: 'pid,hostname,service,version,env',
            },
          }
        : undefined,
    },
  };
}
