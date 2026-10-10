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
import type { Logger as TypeOrmLoggerContract } from 'typeorm';
import { TypeOrmLogger } from './typeorm.logger.js';

describe('TypeOrmLogger', () => {
  // Typed as TypeORM calls it: with the query parameters.
  const logger: TypeOrmLoggerContract = new TypeOrmLogger();
  let log: MockInstance<Logger['log']>;
  let warn: MockInstance<Logger['warn']>;
  let debug: MockInstance<Logger['debug']>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a failed query at warn with the SQL and the error, without parameters', () => {
    const error = new Error('duplicate key value');

    logger.logQueryError(
      error,
      'INSERT INTO users (email, password) VALUES ($1, $2)',
      ['a@b.c', 's3cret'],
    );

    expect(warn).toHaveBeenCalledExactlyOnceWith({
      msg: 'Query failed',
      err: error,
      query: 'INSERT INTO users (email, password) VALUES ($1, $2)',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cret');
  });

  it('logs a slow query at warn with its duration, without parameters', () => {
    logger.logQuerySlow(1234, 'SELECT * FROM users WHERE email = $1', [
      'a@b.c',
    ]);

    expect(warn).toHaveBeenCalledExactlyOnceWith({
      msg: 'Slow query',
      durationMs: 1234,
      query: 'SELECT * FROM users WHERE email = $1',
    });
  });

  it('logs every query at debug only, without parameters', () => {
    logger.logQuery('SELECT * FROM users WHERE email = $1', ['a@b.c']);

    expect(debug).toHaveBeenCalledExactlyOnceWith({
      msg: 'Query',
      query: 'SELECT * FROM users WHERE email = $1',
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('cuts a very long query and says how long it was', () => {
    const query = `INSERT INTO t VALUES ${'($1),'.repeat(1000)}`;

    logger.logQuerySlow(900, query);

    const { query: logged } = warn.mock.calls[0][0] as { query: string };
    expect(logged).toHaveLength(2000 + `… (${query.length} characters)`.length);
    expect(logged.startsWith('INSERT INTO t VALUES ($1),')).toBe(true);
    expect(logged.endsWith(`… (${query.length} characters)`)).toBe(true);
  });

  it('keeps a query of exactly 2000 characters whole', () => {
    const query = 'x'.repeat(2000);

    logger.logQuerySlow(900, query);

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ query }),
    );
  });

  it('logs migrations at info and schema builds at debug', () => {
    logger.logMigration('Migration AddUsers1700000000000 has been executed');
    logger.logSchemaBuild('creating a new table: users');

    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Migration AddUsers1700000000000 has been executed',
    );
    expect(debug).toHaveBeenCalledExactlyOnceWith(
      'creating a new table: users',
    );
  });

  it('maps the general TypeORM levels to the Nest ones', () => {
    logger.log('warn', 'careful');
    logger.log('info', 'fyi');
    logger.log('log', 'note');

    expect(warn).toHaveBeenCalledExactlyOnceWith('careful');
    expect(log.mock.calls).toEqual([['fyi'], ['note']]);
  });

  it('logs under the TypeORM context', () => {
    const contexts: unknown[] = [];
    warn.mockImplementation(function (this: Logger) {
      contexts.push((this as unknown as { context: string }).context);
    });

    logger.log('warn', 'careful');

    expect(contexts).toEqual(['TypeORM']);
  });
});
