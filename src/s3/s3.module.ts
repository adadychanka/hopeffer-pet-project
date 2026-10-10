import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { S3HealthIndicator } from './s3.health.js';
import { S3Service } from './s3.service.js';

@Global()
@Module({
  imports: [TerminusModule],
  providers: [S3Service, S3HealthIndicator],
  exports: [S3Service],
})
export class S3Module {}
