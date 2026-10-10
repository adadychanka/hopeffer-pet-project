import { describe, expect, it } from 'vitest';
import type { StdSerializedResults } from 'pino-http';
import {
  maskQueryValues,
  serializeError,
  serializeRequest,
  serializeResponse,
  shortenQuery,
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

// The shape of TypeORM's QueryFailedError: the SQL, its parameters and the
// fields of the Postgres driver error, all as own properties.
function queryFailedError(query: string): Error {
  return Object.assign(new Error('duplicate key value'), {
    query,
    parameters: ['a@b.c', 's3cret'],
    driverError: new Error('driver s3cret'),
    code: '23505',
    table: 'users',
    constraint: 'users_email_key',
  });
}

describe('shortenQuery', () => {
  it('keeps a query of up to 2000 characters whole', () => {
    expect(shortenQuery('x'.repeat(2000))).toBe('x'.repeat(2000));
  });

  it('cuts a longer query and says how long it was', () => {
    expect(shortenQuery('x'.repeat(2001))).toBe(
      `${'x'.repeat(2000)}… (2001 characters)`,
    );
  });
});

describe('serializeError', () => {
  it('keeps the type, message, stack and the fields that identify the failure', () => {
    const serialized = serializeError(queryFailedError('INSERT INTO users'));

    expect(serialized).toEqual({
      type: 'Error',
      message: 'duplicate key value',
      stack: expect.stringContaining('duplicate key value') as string,
      query: 'INSERT INTO users',
      code: '23505',
      table: 'users',
      constraint: 'users_email_key',
    });
  });

  it('never logs query parameters or a nested driver error', () => {
    const serialized = serializeError(queryFailedError('INSERT INTO users'));

    expect(serialized).not.toHaveProperty('parameters');
    expect(serialized).not.toHaveProperty('driverError');
    expect(JSON.stringify(serialized)).not.toContain('s3cret');
  });

  it('cuts megabytes of SQL at 2000 characters', () => {
    const query = `INSERT INTO t VALUES ${'($1),'.repeat(200_000)}`;

    const serialized = serializeError(queryFailedError(query)) as {
      query: string;
    };

    expect(serialized.query).toBe(shortenQuery(query));
    expect(JSON.stringify(serialized).length).toBeLessThan(5000);
  });

  it('drops fields nobody listed, such as the request a client library attaches', () => {
    // The shape of an OpenSearch ResponseError.
    const error = Object.assign(new Error('search_phase_execution_exception'), {
      statusCode: 400,
      meta: {
        meta: { request: { params: { body: '{"password":"s3cret"}' } } },
      },
    });

    expect(serializeError(error)).toEqual({
      type: 'Error',
      message: 'search_phase_execution_exception',
      stack: expect.any(String) as string,
      statusCode: 400,
    });
  });

  it('applies the same rules to every error of an AggregateError', () => {
    const serialized = serializeError(
      new AggregateError(
        [queryFailedError('INSERT INTO users'), new Error('second')],
        'both failed',
      ),
    ) as { aggregateErrors: Record<string, unknown>[] };

    expect(serialized.aggregateErrors).toHaveLength(2);
    expect(serialized.aggregateErrors[0]).toMatchObject({
      message: 'duplicate key value',
      query: 'INSERT INTO users',
    });
    expect(JSON.stringify(serialized)).not.toContain('s3cret');
  });

  it('accepts an error that pino-http has already serialized', () => {
    const alreadySerialized = {
      type: 'QueryFailedError',
      message: 'duplicate key value',
      stack: 'QueryFailedError: duplicate key value\n    at x',
      query: 'INSERT INTO users',
      parameters: ['s3cret'],
    };

    expect(serializeError(alreadySerialized)).toEqual({
      type: 'QueryFailedError',
      message: 'duplicate key value',
      stack: 'QueryFailedError: duplicate key value\n    at x',
      query: 'INSERT INTO users',
    });
  });

  it('returns a value that is not an error as it is', () => {
    expect(serializeError('just a string')).toBe('just a string');
    expect(serializeError(undefined)).toBeUndefined();
    expect(serializeError(null)).toBeNull();
  });
});
