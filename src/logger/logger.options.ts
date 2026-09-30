import type { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import type { TransportTargetOptions } from 'pino';
import type { Env } from '../config/env.js';

export function loggerOptions(
  config: ConfigService<Env, true>,
  isTTY = Boolean(process.stdout.isTTY),
): Params {
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const level =
    config.get('LOG_LEVEL', { infer: true }) ??
    (nodeEnv === 'test' ? 'silent' : 'info');
  const logFile = config.get('LOG_FILE', { infer: true });

  // Pretty output only for a developer terminal. Containers and CI get JSON lines.
  const pretty = isTTY && nodeEnv !== 'production';

  const consoleTarget: TransportTargetOptions = pretty
    ? { target: 'pino-pretty', level, options: { singleLine: true } }
    : { target: 'pino/file', level, options: { destination: 1 } };

  // Opt-in file output with rotation. LOG_FILE is a path such as `logs/app`,
  // which gives `logs/app.2026-09-25.1.log`. Its folder must hold only these
  // logs, because rotation also deletes old files that other processes wrote.
  const fileTarget: TransportTargetOptions | undefined = logFile
    ? {
        target: 'pino-roll',
        level,
        options: {
          file: logFile,
          frequency: 'daily',
          dateFormat: 'yyyy-MM-dd',
          size: '10m',
          limit: { count: 14, removeOtherLogFiles: true },
          mkdir: true,
          symlink: true,
        },
      }
    : undefined;

  return {
    pinoHttp: {
      level,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      // Without a file and pretty output, skip transports: Pino then writes
      // straight to stdout without a worker thread.
      transport: fileTarget
        ? { targets: [consoleTarget, fileTarget] }
        : pretty
          ? consoleTarget
          : undefined,
    },
  };
}
