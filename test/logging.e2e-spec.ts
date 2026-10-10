import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('Logging (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
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
});
