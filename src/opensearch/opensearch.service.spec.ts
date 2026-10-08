import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { OpensearchService } from './opensearch.service.js';

function connection(settings: Partial<Env>) {
  const service = new OpensearchService(
    new ConfigService<Env, true>({
      OPENSEARCH_NODE: 'https://opensearch.internal:9200',
      ...settings,
    }),
  );
  return service.connectionPool.connections[0];
}

describe('OpensearchService', () => {
  it('connects to the node from OPENSEARCH_NODE without auth or a custom CA', () => {
    const { url, headers, ssl } = connection({
      OPENSEARCH_NODE: 'http://opensearch.internal:9200',
    });

    expect(url.href).toBe('http://opensearch.internal:9200/');
    expect(headers).not.toHaveProperty('authorization');
    expect(ssl).toBeNull();
  });

  it('sends basic auth from OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD', () => {
    const { headers } = connection({
      OPENSEARCH_USERNAME: 'admin',
      OPENSEARCH_PASSWORD: 'secret',
    });

    expect(headers).toMatchObject({
      authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}`,
    });
  });

  it('trusts the CA certificate from OPENSEARCH_CA_CERT', () => {
    const pem = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';

    expect(connection({ OPENSEARCH_CA_CERT: pem }).ssl?.ca).toBe(pem);
  });
});
