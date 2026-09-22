import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RedisCacheModule } from './cache/redis-cache.module.js';
import { MinioModule } from './minio/minio.module.js';
import { OpensearchModule } from './opensearch/opensearch.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, RedisCacheModule, MinioModule, OpensearchModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
