import { Logger } from '@nestjs/common';
import type { Logger as TypeOrmLoggerContract } from 'typeorm';
import { shortenQuery } from '../logger/serializers.js';

// Sends TypeORM's logs through the Nest logger, so they are JSON lines with
// the request ID like every other log. TypeORM's own loggers write plain text
// with console.log. Query parameters are never logged: they hold user data.
export class TypeOrmLogger implements TypeOrmLoggerContract {
  private readonly logger = new Logger('TypeORM');

  // Every query, visible only with LOG_LEVEL=debug.
  logQuery(query: string): void {
    this.logger.debug({ msg: 'Query', query: shortenQuery(query) });
  }

  // warn, not error: the caller may handle the failure (a unique violation
  // turned into a 409). An unhandled one is logged again at error by Nest.
  logQueryError(error: string | Error, query: string): void {
    this.logger.warn({
      msg: 'Query failed',
      err: error,
      query: shortenQuery(query),
    });
  }

  logQuerySlow(time: number, query: string): void {
    this.logger.warn({
      msg: 'Slow query',
      durationMs: time,
      query: shortenQuery(query),
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
