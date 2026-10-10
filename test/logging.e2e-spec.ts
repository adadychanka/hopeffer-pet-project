import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';

// ConfigModule reads process.env when app.module.js is imported, so the
// threshold must be set before the imports run.
vi.hoisted(() => {
  process.env.DB_SLOW_QUERY_MS = '50';
});

const { AppModule } = await import('./../src/app.module.js');

describe('Logging (e2e)', () => {
  let app: INestApplication<App>;
  let warn: MockInstance<Logger['warn']>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ logger: false });
    await app.init();
    warn = vi.spyOn(Logger.prototype, 'warn');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('echoes a safe incoming request ID', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .set('x-request-id', 'lb-42')
      .expect(200);

    expect(res.headers['x-request-id']).toBe('lb-42');
  });

  it('creates a request ID when the request has none, also on an error response', async () => {
    const ok = await request(app.getHttpServer()).get('/').expect(200);
    const missing = await request(app.getHttpServer())
      .get('/missing')
      .expect(404);

    expect(ok.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(missing.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(ok.headers['x-request-id']).not.toBe(
      missing.headers['x-request-id'],
    );
  });

  it('logs a failed query with its SQL and without its parameters', async () => {
    const dataSource = app.get(DataSource);

    await expect(
      dataSource.query('SELECT $1::text FROM table_that_does_not_exist', [
        's3cret',
      ]),
    ).rejects.toThrow(/table_that_does_not_exist/);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Query failed',
        query: 'SELECT $1::text FROM table_that_does_not_exist',
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('s3cret');
  });

  it('logs a query slower than DB_SLOW_QUERY_MS, and not a fast one', async () => {
    const dataSource = app.get(DataSource);

    await dataSource.query('SELECT pg_sleep(0.2)');
    await dataSource.query('SELECT 1');

    const slow = warn.mock.calls
      .map(([line]) => line as { msg?: string; query?: string })
      .filter((line) => line.msg === 'Slow query');
    expect(slow).toEqual([
      {
        msg: 'Slow query',
        durationMs: expect.any(Number) as number,
        query: 'SELECT pg_sleep(0.2)',
      },
    ]);
  });
});
