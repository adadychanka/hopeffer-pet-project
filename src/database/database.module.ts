import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { TypeOrmLogger } from './typeorm.logger.js';
import { buildTypeOrmOptions } from './typeorm-options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        ...buildTypeOrmOptions(config.get('DATABASE_URL', { infer: true })),
        extra: { max: config.get('DB_POOL_SIZE', { infer: true }) },
        logger: new TypeOrmLogger(),
        maxQueryExecutionTime: config.get('DB_SLOW_QUERY_MS', { infer: true }),
        // Entities register through TypeOrmModule.forFeature() in feature modules.
        autoLoadEntities: true,
      }),
    }),
    TerminusModule,
  ],
  providers: [DatabaseHealthIndicator],
})
export class DatabaseModule {}
