import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { Logger } from '@nestjs/common';
import { createCache } from 'cache-manager';
import { Keyv } from 'keyv';
import { RedisCacheErrors, REPEAT_MS } from './redis-cache.errors.js';

describe('RedisCacheErrors', () => {
  let error: MockInstance<Logger['error']>;
  let store: Keyv;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-10T00:00:00Z') });
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    store = new Keyv();
    new RedisCacheErrors(createCache({ stores: [store] })).onModuleInit();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs a client error at error with the cause', () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:6379');

    store.emit('error', cause);

    expect(error).toHaveBeenCalledExactlyOnceWith({
      msg: 'Redis client error',
      err: cause,
      suppressed: 0,
    });
  });

  it('logs one line per interval while the client keeps retrying', () => {
    for (let second = 0; second < 25; second += 1) {
      store.emit('error', new Error(`attempt ${second}`));
      vi.advanceTimersByTime(1000);
    }

    // Errors at 0 s, 10 s and 20 s. Nine were dropped before each later line.
    expect(error.mock.calls.map(([line]) => line as unknown)).toEqual([
      expect.objectContaining({ suppressed: 0 }),
      expect.objectContaining({ suppressed: 9 }),
      expect.objectContaining({ suppressed: 9 }),
    ]);
  });

  it('logs again as soon as the interval has passed', () => {
    store.emit('error', new Error('first'));
    vi.advanceTimersByTime(REPEAT_MS - 1);
    store.emit('error', new Error('dropped'));
    vi.advanceTimersByTime(1);
    store.emit('error', new Error('second'));

    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenLastCalledWith(
      expect.objectContaining({ suppressed: 1 }),
    );
  });

  it('listens on every store of the cache', () => {
    const second = new Keyv();
    new RedisCacheErrors(
      createCache({ stores: [new Keyv(), second] }),
    ).onModuleInit();

    second.emit('error', new Error('second store'));

    expect(error).toHaveBeenCalledOnce();
  });
});
