import { describe, expect, it } from 'vitest';
import type { StdSerializedResults } from 'pino-http';
import {
  maskQueryValues,
  serializeRequest,
  serializeResponse,
} from './serializers.js';

// The shape pino-http's own serializer hands over.
function stdRequest(
  change: Partial<StdSerializedResults['req']> = {},
): StdSerializedResults['req'] {
  return {
    id: 'req-1',
    method: 'GET',
    url: '/users',
    query: {},
    params: {},
    headers: {},
    remoteAddress: '10.0.0.7',
    remotePort: 51234,
    ...change,
  } as StdSerializedResults['req'];
}

describe('maskQueryValues', () => {
  it.each([
    ['/users', '/users'],
    ['/users?page=2', '/users?page=[Redacted]'],
    [
      '/reset?token=s3cret&email=a@b.c',
      '/reset?token=[Redacted]&email=[Redacted]',
    ],
    ['/search?q=a=b', '/search?q=[Redacted]'],
    ['/flags?debug&x=1', '/flags?debug&x=[Redacted]'],
    ['/empty?', '/empty?'],
    ['/a?x=1?y=2', '/a?x=[Redacted]'],
  ])('turns %s into %s', (url, expected) => {
    expect(maskQueryValues(url)).toBe(expected);
  });
});

describe('serializeRequest', () => {
  it('keeps the ID, method, masked URL and remote address', () => {
    expect(
      serializeRequest(stdRequest({ url: '/reset?token=s3cret' })),
    ).toEqual({
      id: 'req-1',
      method: 'GET',
      url: '/reset?token=[Redacted]',
      headers: {},
      remoteAddress: '10.0.0.7',
      remotePort: 51234,
    });
  });

  it('logs only the allowed headers', () => {
    const { headers } = serializeRequest(
      stdRequest({
        headers: {
          host: 'api.example.com',
          'user-agent': 'curl/8.7.1',
          'content-type': 'application/json',
          'x-request-id': 'req-1',
          authorization: 'Bearer s3cret',
          cookie: 'session=s3cret',
          'proxy-authorization': 'Basic s3cret',
          'x-api-key': 's3cret',
          'x-new-secret-header': 's3cret',
          referer: 'https://example.com/reset?token=s3cret',
        },
      }),
    );

    expect(headers).toEqual({
      host: 'api.example.com',
      'user-agent': 'curl/8.7.1',
      'content-type': 'application/json',
    });
  });

  it('drops the parsed query and route params, which repeat the URL unmasked', () => {
    const serialized = serializeRequest(
      stdRequest({ query: { token: 's3cret' }, params: { id: '42' } }),
    );

    expect(serialized).not.toHaveProperty('query');
    expect(serialized).not.toHaveProperty('params');
    expect(JSON.stringify(serialized)).not.toContain('s3cret');
  });

  it('handles a request without headers', () => {
    expect(
      serializeRequest(stdRequest({ headers: undefined })).headers,
    ).toEqual({});
  });
});

describe('serializeResponse', () => {
  it('keeps the status and only the allowed headers', () => {
    expect(
      serializeResponse({
        statusCode: 302,
        headers: {
          'content-type': 'text/html',
          'content-length': '0',
          'x-request-id': 'req-1',
          'set-cookie': ['session=s3cret; HttpOnly'],
          location: 'https://example.com/callback?code=s3cret',
          'x-powered-by': 'Express',
        },
      } as unknown as StdSerializedResults['res']),
    ).toEqual({
      statusCode: 302,
      headers: {
        'content-type': 'text/html',
        'content-length': '0',
      },
    });
  });
});
