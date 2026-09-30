import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL', { infer: true }),
        // Entities register through TypeOrmModule.forFeature() in feature modules.
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
