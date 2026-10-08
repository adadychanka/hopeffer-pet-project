import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.js';
import { DatabaseHealthIndicator } from './database.health.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL', { infer: true }),
        extra: { max: config.get('DB_POOL_SIZE', { infer: true }) },
        // Entities register through TypeOrmModule.forFeature() in feature modules.
        autoLoadEntities: true,
      }),
    }),
    TerminusModule,
  ],
  providers: [DatabaseHealthIndicator],
})
export class DatabaseModule {}
