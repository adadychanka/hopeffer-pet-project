import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RedisCacheModule } from './cache/redis-cache.module.js';
import { DatabaseModule } from './database/database.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { MinioModule } from './minio/minio.module.js';
import { OpensearchModule } from './opensearch/opensearch.module.js';

@Module({
  imports: [
    LoggerModule,
    DatabaseModule,
    RedisCacheModule,
    MinioModule,
    OpensearchModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
