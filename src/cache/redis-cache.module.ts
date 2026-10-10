import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { createKeyv } from '@keyv/redis';
import { createCache } from 'cache-manager';
import type { Env } from '../config/env.js';
import { RedisCacheErrors } from './redis-cache.errors.js';
import { RedisCacheHealthIndicator } from './redis-cache.health.js';
import { RedisCacheShutdown } from './redis-cache.shutdown.js';

// Provides CACHE_MANAGER itself instead of CacheModule.registerAsync(), which
// would disconnect Redis in onModuleDestroy, while requests still run.
// RedisCacheShutdown disconnects after the HTTP server has closed.
@Global()
@Module({
  imports: [TerminusModule],
  providers: [
    {
      provide: CACHE_MANAGER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createCache({
          stores: [createKeyv(config.get('REDIS_URL', { infer: true }))],
        }),
    },
    RedisCacheErrors,
    RedisCacheShutdown,
    RedisCacheHealthIndicator,
  ],
  exports: [CACHE_MANAGER],
})
export class RedisCacheModule {}
