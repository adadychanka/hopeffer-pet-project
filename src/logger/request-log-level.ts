import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LevelWithSilent } from 'pino';

// Kubernetes calls these every few seconds.
const PROBE_PATHS = new Set(['/live', '/ready']);

// The level of the "request completed" line. pino-http logs every request at
// info by default, also a 500.
export function requestLogLevel(
  req: IncomingMessage,
  res: ServerResponse,
  err?: Error,
): LevelWithSilent {
  const path = (req.url ?? '').split('?', 1)[0];
  if (PROBE_PATHS.has(path)) {
    // A passing probe is noise. A failing one is expected during an outage or
    // the shutdown drain, so it must not page anyone: warn, not error.
    return res.statusCode < 400 ? 'silent' : 'warn';
  }
  if (err || res.statusCode >= 500) {
    return 'error';
  }
  return res.statusCode >= 400 ? 'warn' : 'info';
}
