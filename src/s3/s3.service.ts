import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../config/env.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class S3Service extends S3Client {
  constructor(config: ConfigService<Env, true>) {
    super({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
      // RustFS and other self-hosted S3 servers serve buckets as a path
      // (host/bucket/key), not as a subdomain (bucket.host/key).
      forcePathStyle: true,
    });
  }
}
