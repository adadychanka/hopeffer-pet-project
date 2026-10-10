import pino, { type DestinationStream } from 'pino';
import { isPretty, logFormat, type LogFields } from './log-format.js';

export type CrashReporter = (err: unknown, msg: string) => void;

export interface CrashOptions {
  isTTY: boolean;
  // Synchronous by default: the line is on stdout before the process exits.
  stream?: DestinationStream;
  exit?: (code: number) => void;
}

// Reports an error the app cannot survive and exits with code 1. It does not
// use the app logger or the validated config, because it must work when they
// are what failed: it runs before Nest starts and after an uncaught exception.
// Outside a developer terminal the report is one fatal JSON line, in the same
// shape as every other log line, so a log collector does not split a stack
// trace into separate lines.
export function crashReporter(
  env: LogFields,
  { isTTY, stream, exit = (code) => process.exit(code) }: CrashOptions,
): CrashReporter {
  const pretty = isPretty(env.NODE_ENV, isTTY);
  const logger = pretty
    ? undefined
    : pino(logFormat(env), stream ?? pino.destination({ dest: 1, sync: true }));

  return (err, msg) => {
    if (logger) {
      logger.fatal({ err }, msg);
    } else {
      console.error(msg, err);
    }
    exit(1);
  };
}

// Node reports an unhandled promise rejection as an uncaught exception, with
// this origin.
export function crashMessage(origin: NodeJS.UncaughtExceptionOrigin): string {
  return origin === 'unhandledRejection'
    ? 'Unhandled promise rejection'
    : 'Uncaught exception';
}
