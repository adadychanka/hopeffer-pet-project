import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import type { Env } from '../config/env.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class OpensearchService extends Client {
  constructor(config: ConfigService<Env, true>) {
    // The env schema allows both username and password or neither.
    const username = config.get('OPENSEARCH_USERNAME', { infer: true });
    const password = config.get('OPENSEARCH_PASSWORD', { infer: true });
    const caCert = config.get('OPENSEARCH_CA_CERT', { infer: true });
    super({
      node: config.get('OPENSEARCH_NODE', { infer: true }),
      auth: username && password ? { username, password } : undefined,
      ssl: caCert ? { ca: caCert } : undefined,
    });
  }
}
