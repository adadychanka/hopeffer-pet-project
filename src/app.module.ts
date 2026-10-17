import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RedisCacheModule } from './cache/redis-cache.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DealsModule } from './deals/deals.module.js';
import { HealthModule } from './health/health.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { OpensearchModule } from './opensearch/opensearch.module.js';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module.js';
import { S3Module } from './s3/s3.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Loads .env when the file exists; real env vars take precedence. Tests
      // ignore it, so a developer's .env cannot change what they run against.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    LoggerModule,
    DatabaseModule,
    RedisCacheModule,
    S3Module,
    OpensearchModule,
    HealthModule,
    CompaniesModule,
    LedgerModule,
    PlatformSettingsModule,
    CatalogModule,
    DealsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
