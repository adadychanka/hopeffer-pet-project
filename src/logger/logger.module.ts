import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { TransportTargetOptions } from 'pino';

const level =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

// Pretty output only for a developer terminal. Containers and CI get JSON lines.
const pretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production';

const consoleTarget: TransportTargetOptions = pretty
  ? { target: 'pino-pretty', level, options: { singleLine: true } }
  : { target: 'pino/file', level, options: { destination: 1 } };

// Opt-in file output with rotation. LOG_FILE is a path such as `logs/app`,
// which gives `logs/app.2026-09-25.1.log`. Its folder must hold only these
// logs, because rotation also deletes old files that other processes wrote.
const fileTarget: TransportTargetOptions | undefined = process.env.LOG_FILE
  ? {
      target: 'pino-roll',
      level,
      options: {
        file: process.env.LOG_FILE,
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        size: '10m',
        limit: { count: 14, removeOtherLogFiles: true },
        mkdir: true,
        symlink: true,
      },
    }
  : undefined;

@Module({
  imports: [
    PinoLoggerModule.forRoot({
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
    }),
  ],
})
export class LoggerModule {}
