import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import type { Env } from '../config/env.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class OpensearchService extends Client {
  constructor(config: ConfigService<Env, true>) {
    super({
      node: config.get('OPENSEARCH_NODE', { infer: true }),
    });
  }
}
