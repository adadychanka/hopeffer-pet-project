import { afterEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { crashMessage, crashReporter } from './crash.js';

function capture() {
  let written = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      written += chunk.toString();
      done();
    },
  });
  return { stream, lines: () => written.split('\n').filter(Boolean) };
}

describe('crashReporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one fatal JSON line in the app log format, then exits with code 1', () => {
    const { stream, lines } = capture();
    const order: string[] = [];
    const exit = vi.fn(() => order.push(`exit after ${lines().length} line`));
    const crash = crashReporter(
      { NODE_ENV: 'production', APP_VERSION: 'abc1234', APP_ENV: 'staging' },
      { isTTY: false, stream, exit },
    );

    crash(
      new Error('Invalid environment variables:\n✖ DATABASE_URL'),
      'Application failed to start',
    );

    expect(lines()).toHaveLength(1);
    expect(JSON.parse(lines()[0])).toMatchObject({
      level: 'fatal',
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      service: 'hopeffer-pet-project',
      version: 'abc1234',
      env: 'staging',
      msg: 'Application failed to start',
      err: {
        type: 'Error',
        message: 'Invalid environment variables:\n✖ DATABASE_URL',
        stack: expect.stringContaining('crash.spec.ts') as string,
      },
    });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    // The line is written before the process exits.
    expect(order).toEqual(['exit after 1 line']);
  });

  it('writes JSON in a terminal when NODE_ENV is production', () => {
    const { stream, lines } = capture();
    const crash = crashReporter(
      { NODE_ENV: 'production' },
      { isTTY: true, stream, exit: vi.fn() },
    );

    crash(new Error('boom'), 'Uncaught exception');

    expect(JSON.parse(lines()[0])).toMatchObject({ level: 'fatal' });
  });

  it('reports a thrown value that is not an Error', () => {
    const { stream, lines } = capture();
    const exit = vi.fn();
    const crash = crashReporter({}, { isTTY: false, stream, exit });

    crash('just a string', 'Uncaught exception');

    expect(JSON.parse(lines()[0])).toMatchObject({
      level: 'fatal',
      err: 'just a string',
      msg: 'Uncaught exception',
    });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('prints a readable error in a developer terminal, then exits with code 1', () => {
    const { stream, lines } = capture();
    const exit = vi.fn();
    const print = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Invalid environment variables');
    const crash = crashReporter(
      { NODE_ENV: 'development' },
      { isTTY: true, stream, exit },
    );

    crash(error, 'Application failed to start');

    expect(print).toHaveBeenCalledExactlyOnceWith(
      'Application failed to start',
      error,
    );
    expect(lines()).toEqual([]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits the process by default', () => {
    const { stream } = capture();
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    crashReporter({}, { isTTY: false, stream })(new Error('boom'), 'Crash');

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('writes to stdout by default', () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    expect(() =>
      crashReporter({}, { isTTY: false, exit: vi.fn() }),
    ).not.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('crashMessage', () => {
  it('names the kind of crash', () => {
    expect(crashMessage('uncaughtException')).toBe('Uncaught exception');
    expect(crashMessage('unhandledRejection')).toBe(
      'Unhandled promise rejection',
    );
  });
});
