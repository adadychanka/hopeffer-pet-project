import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RedisCacheModule } from './cache/redis-cache.module.js';
import { DatabaseModule } from './database/database.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { OpensearchModule } from './opensearch/opensearch.module.js';
import { S3Module } from './s3/s3.module.js';

@Module({
  imports: [
    LoggerModule,
    DatabaseModule,
    RedisCacheModule,
    S3Module,
    OpensearchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
