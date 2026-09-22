import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { createKeyv } from '@keyv/redis';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => ({
        stores: [createKeyv(process.env.REDIS_URL)],
      }),
    }),
  ],
  exports: [CacheModule],
})
export class RedisCacheModule {}
