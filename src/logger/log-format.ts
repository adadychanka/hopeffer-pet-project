import { hostname } from 'node:os';
import { stdTimeFunctions, type LoggerOptions } from 'pino';
import { packageInfo } from './package-info.js';

// The settings that name a deployment in the logs. Both the app logger (from
// ConfigService) and the crash reporter (from process.env) pass them in.
export interface LogFields {
  APP_VERSION?: string;
  APP_ENV?: string;
  NODE_ENV?: string;
}

// Pretty output only for a developer terminal. Containers and CI get JSON lines.
export function isPretty(nodeEnv: string | undefined, isTTY: boolean): boolean {
  return isTTY && nodeEnv !== 'production';
}

// One JSON shape for every log line: `"level":"error"` instead of 50, an ISO
// `time`, and the fields that tell deployments apart. Loki, ELK and Datadog
// parse this without a mapping rule.
export function logFormat(
  fields: LogFields,
): Pick<LoggerOptions, 'base' | 'timestamp' | 'formatters'> {
  const { name, version } = packageInfo();
  return {
    base: {
      service: name,
      // `||`, not `??`: the crash reporter reads process.env, where a deploy
      // template can leave an empty string.
      version: fields.APP_VERSION || version,
      env: fields.APP_ENV || fields.NODE_ENV || 'development',
      pid: process.pid,
      hostname: hostname(),
    },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
}
