import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Cache } from 'cache-manager';

// Disconnects Redis in onApplicationShutdown, which Nest runs after the HTTP
// server has closed and its requests have finished. CacheModule from
// @nestjs/cache-manager disconnects in onModuleDestroy instead, which Nest
// runs before the shutdown drain and before HTTP closes.
/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class RedisCacheShutdown implements OnApplicationShutdown {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async onApplicationShutdown(): Promise<void> {
    await this.cache.disconnect();
  }
}
