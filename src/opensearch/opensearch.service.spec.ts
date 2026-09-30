import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { OpensearchService } from './opensearch.service.js';

describe('OpensearchService', () => {
  it('connects to the node from OPENSEARCH_NODE', () => {
    const service = new OpensearchService(
      new ConfigService<Env, true>({
        OPENSEARCH_NODE: 'http://opensearch.internal:9200',
      }),
    );

    expect(service.connectionPool.connections.map((c) => c.url.href)).toEqual([
      'http://opensearch.internal:9200/',
    ]);
  });
});
