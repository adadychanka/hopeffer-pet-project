import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ReadinessLogger } from './readiness.logger.js';

describe('ReadinessLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes what terminus reports as an error at warn', () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    new ReadinessLogger().error('Health Check has failed! {"redis":"down"}');

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Health Check has failed! {"redis":"down"}',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps the level of the other messages', () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const logger = new ReadinessLogger();

    logger.log('Received termination signal');
    logger.warn('careful');

    expect(log).toHaveBeenCalledExactlyOnceWith('Received termination signal');
    expect(warn).toHaveBeenCalledExactlyOnceWith('careful');
  });
});
