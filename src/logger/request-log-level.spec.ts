import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { requestLogLevel } from './request-log-level.js';

function level(url: string | undefined, statusCode: number, err?: Error) {
  return requestLogLevel(
    { url } as IncomingMessage,
    { statusCode } as ServerResponse,
    err,
  );
}

describe('requestLogLevel', () => {
  it.each([
    [200, 'info'],
    [302, 'info'],
    [399, 'info'],
    [400, 'warn'],
    [404, 'warn'],
    [499, 'warn'],
    [500, 'error'],
    [503, 'error'],
  ])('logs a %i response at %s', (statusCode, expected) => {
    expect(level('/users', statusCode)).toBe(expected);
  });

  it('logs at error when the response stream failed, whatever the status', () => {
    expect(level('/users', 200, new Error('socket hang up'))).toBe('error');
  });

  it.each(['/live', '/ready', '/ready?verbose=1'])(
    'does not log a passing probe: %s',
    (url) => {
      expect(level(url, 200)).toBe('silent');
    },
  );

  it('logs a failing probe at warn, not error', () => {
    expect(level('/ready', 503)).toBe('warn');
    expect(level('/live', 500)).toBe('warn');
  });

  it('treats only the exact probe paths as probes', () => {
    expect(level('/ready/extra', 200)).toBe('info');
    expect(level('/api/live', 200)).toBe('info');
  });

  it('handles a request without a URL', () => {
    expect(level(undefined, 200)).toBe('info');
  });
});
