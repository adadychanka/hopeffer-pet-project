import { afterEach, describe, expect, it } from 'vitest';
import { OpensearchService } from './opensearch.service.js';

describe('OpensearchService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('connects to the node from OPENSEARCH_NODE', () => {
    process.env.OPENSEARCH_NODE = 'http://opensearch.internal:9200';

    const service = new OpensearchService();

    expect(service.connectionPool.connections.map((c) => c.url.href)).toEqual([
      'http://opensearch.internal:9200/',
    ]);
  });

  it('falls back to the local default when OPENSEARCH_NODE is unset', () => {
    delete process.env.OPENSEARCH_NODE;

    const service = new OpensearchService();

    expect(service.connectionPool.connections.map((c) => c.url.href)).toEqual([
      'http://localhost:9200/',
    ]);
  });
});
