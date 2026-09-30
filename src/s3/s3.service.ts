import { Injectable } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service extends S3Client {
  constructor() {
    super({
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
      // RustFS and other self-hosted S3 servers serve buckets as a path
      // (host/bucket/key), not as a subdomain (bucket.host/key).
      forcePathStyle: true,
    });
  }
}
