import { afterEach, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import type { Env } from './../src/config/env.js';
import { OpensearchService } from './../src/opensearch/opensearch.service.js';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app.close();
  });

  async function start(
    opensearch?: OpensearchService,
  ): Promise<INestApplication<App>> {
    let builder = Test.createTestingModule({ imports: [AppModule] });
    if (opensearch) {
      builder = builder
        .overrideProvider(OpensearchService)
        .useValue(opensearch);
    }
    const moduleFixture = await builder.compile();
    app = moduleFixture.createNestApplication({ logger: false });
    await app.init();
    return app;
  }

  it('GET /live answers 200 and checks no dependency', async () => {
    await start();

    await request(app.getHttpServer())
      .get('/live')
      .expect(200)
      .expect({ status: 'ok', info: {}, error: {}, details: {} });
  });

  it('GET /ready answers 200 when every backing service is up', async () => {
    await start();

    const res = await request(app.getHttpServer()).get('/ready').expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      details: {
        database: { status: 'up' },
        redis: { status: 'up' },
        s3: { status: 'up' },
        opensearch: { status: 'up' },
      },
    });
  });

  it('GET /ready answers 503 and names the service that is down, while /live stays 200', async () => {
    // Port 1 refuses connections, so OpenSearch is down for this app only.
    const unreachable = new OpensearchService(
      new ConfigService<Env, true>({ OPENSEARCH_NODE: 'http://127.0.0.1:1' }),
    );
    await start(unreachable);

    const res = await request(app.getHttpServer()).get('/ready').expect(503);

    expect(res.body).toMatchObject({
      status: 'error',
      info: {
        database: { status: 'up' },
        redis: { status: 'up' },
        s3: { status: 'up' },
      },
      error: { opensearch: { status: 'down' } },
    });
    await request(app.getHttpServer()).get('/live').expect(200);
  });
});
