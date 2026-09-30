import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createKeyv } from '@keyv/redis';
import type { Env } from '../config/env.js';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        stores: [createKeyv(config.get('REDIS_URL', { infer: true }))],
      }),
    }),
  ],
  exports: [CacheModule],
})
export class RedisCacheModule {}
