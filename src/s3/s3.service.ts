import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../config/env.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class S3Service extends S3Client implements OnApplicationShutdown {
  constructor(config: ConfigService<Env, true>) {
    // The env schema allows both keys or neither.
    const accessKeyId = config.get('S3_ACCESS_KEY', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_KEY', { infer: true });
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    super({
      endpoint,
      // Without S3_REGION the SDK reads AWS_REGION, which EKS and ECS set.
      region: config.get('S3_REGION', { infer: true }),
      // Without static keys the SDK's default chain finds credentials: AWS_*
      // env vars, web identity (IRSA), container or instance roles.
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
      // RustFS and other self-hosted S3 servers serve buckets as a path
      // (host/bucket/key). AWS S3 serves them as a subdomain (bucket.host/key)
      // and deprecates the path style.
      forcePathStyle: endpoint !== undefined,
    });
  }

  // Nest runs this after the HTTP server has closed. Frees the SDK's
  // keep-alive sockets.
  onApplicationShutdown(): void {
    this.destroy();
  }
}
