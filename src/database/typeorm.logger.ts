import { Logger } from '@nestjs/common';
import type { Logger as TypeOrmLoggerContract } from 'typeorm';

// A bulk insert can be megabytes of SQL.
const MAX_QUERY_LENGTH = 2000;

function shorten(query: string): string {
  return query.length > MAX_QUERY_LENGTH
    ? `${query.slice(0, MAX_QUERY_LENGTH)}… (${query.length} characters)`
    : query;
}

// Sends TypeORM's logs through the Nest logger, so they are JSON lines with
// the request ID like every other log. TypeORM's own loggers write plain text
// with console.log. Query parameters are never logged: they hold user data.
export class TypeOrmLogger implements TypeOrmLoggerContract {
  private readonly logger = new Logger('TypeORM');

  // Every query, visible only with LOG_LEVEL=debug.
  logQuery(query: string): void {
    this.logger.debug({ msg: 'Query', query: shorten(query) });
  }

  // warn, not error: the caller may handle the failure (a unique violation
  // turned into a 409). An unhandled one is logged again at error by Nest.
  logQueryError(error: string | Error, query: string): void {
    this.logger.warn({
      msg: 'Query failed',
      err: error,
      query: shorten(query),
    });
  }

  logQuerySlow(time: number, query: string): void {
    this.logger.warn({
      msg: 'Slow query',
      durationMs: time,
      query: shorten(query),
    });
  }

  logSchemaBuild(message: string): void {
    this.logger.debug(message);
  }

  logMigration(message: string): void {
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }
}
