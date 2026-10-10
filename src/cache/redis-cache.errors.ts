import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Cache } from 'cache-manager';

// While Redis is down the client retries about once a second, and every
// attempt emits an error.
export const REPEAT_MS = 10_000;

// Logs the Redis client's connection errors. Without a listener Keyv drops
// them, and an outage shows only as a failing /ready.
/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class RedisCacheErrors implements OnModuleInit {
  private readonly logger = new Logger('RedisCache');
  private lastLoggedAt = Number.NEGATIVE_INFINITY;
  private suppressed = 0;

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  onModuleInit(): void {
    for (const store of this.cache.stores) {
      store.on('error', (err: unknown) => this.report(err));
    }
  }

  // At most one line per REPEAT_MS. `suppressed` counts the errors dropped
  // since the line before.
  private report(err: unknown): void {
    const now = Date.now();
    if (now - this.lastLoggedAt < REPEAT_MS) {
      this.suppressed += 1;
      return;
    }
    this.logger.error({
      msg: 'Redis client error',
      err,
      suppressed: this.suppressed,
    });
    this.lastLoggedAt = now;
    this.suppressed = 0;
  }
}
