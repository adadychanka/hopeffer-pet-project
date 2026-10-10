import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import {
  Controller,
  Get,
  Injectable,
  Logger,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Logger as PinoNestLogger, LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Env } from '../config/env.js';
import { loggerOptions } from './logger.options.js';

// Boots a small Nest app with the real logger options and collects what Pino
// writes, so these tests check the log lines themselves, not the options.
type Line = Record<string, unknown>;
const lines: Line[] = [];
const stream = new Writable({
  write(chunk: Buffer, _encoding, done) {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      lines.push(JSON.parse(line) as Line);
    }
    done();
  },
});

@Injectable()
class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  create(): void {
    this.logger.log({ msg: 'Order created', orderId: 7 });
  }
}

@Controller()
class TestController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  createOrder(): { ok: true } {
    this.orders.create();
    return { ok: true };
  }

  @Get('boom')
  boom(): never {
    throw new Error('kaput');
  }

  @Get('query-failed')
  queryFailed(): never {
    // The shape of TypeORM's QueryFailedError.
    throw Object.assign(new Error('duplicate key'), {
      query: 'INSERT INTO users (email, password) VALUES ($1, $2)',
      parameters: ['a@b.c', 's3cret'],
    });
  }

  @Get('live')
  live(): string {
    return 'ok';
  }
}

// The one line pino-http writes per request, when the response is sent.
function completed(): Line[] {
  return lines.filter((line) => 'res' in line);
}

describe('Request logging', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const config = new ConfigService<Env, true>({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      APP_VERSION: 'abc1234',
      APP_ENV: 'staging',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [loggerOptions(config, false).pinoHttp, stream],
        }),
      ],
      controllers: [TestController],
      providers: [OrdersService],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoNestLogger));
    await app.init();
  });

  beforeEach(() => {
    lines.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes the level as a label, an ISO time and the deployment fields', async () => {
    await request(app.getHttpServer()).get('/orders').expect(200);

    expect(completed()[0]).toMatchObject({
      level: 'info',
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      service: 'hopeffer-pet-project',
      version: 'abc1234',
      env: 'staging',
      res: { statusCode: 200 },
    });
  });

  it('reuses the incoming request ID on every line of the request and echoes it', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders')
      .set('x-request-id', 'lb-42')
      .expect(200);

    expect(res.headers['x-request-id']).toBe('lb-42');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      reqId: 'lb-42',
      context: 'OrdersService',
      msg: 'Order created',
      orderId: 7,
    });
    // Lines made while the request runs do not repeat the request object.
    expect(lines[0]).not.toHaveProperty('req');
    expect(lines[1]).toMatchObject({ reqId: 'lb-42', req: { id: 'lb-42' } });
  });

  it('gives each request without an ID its own UUID', async () => {
    const first = await request(app.getHttpServer()).get('/orders');
    const second = await request(app.getHttpServer()).get('/orders');

    const ids = [first, second].map((res) => res.headers['x-request-id']);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect(completed().map((line) => line.reqId as string)).toEqual(ids);
  });

  it('replaces an unsafe incoming request ID', async () => {
    const res = await request(app.getHttpServer())
      .get('/orders')
      .set('x-request-id', 'bad id"}')
      .expect(200);

    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(lines)).not.toContain('bad id');
  });

  it('never logs credentials from headers or the query string', async () => {
    await request(app.getHttpServer())
      .get('/orders?token=s3cret-query')
      .set('authorization', 'Bearer s3cret-auth')
      .set('cookie', 'session=s3cret-cookie')
      .set('x-api-key', 's3cret-key')
      .set('user-agent', 'vitest')
      .expect(200);

    const [line] = completed();
    expect(JSON.stringify(lines)).not.toContain('s3cret');
    expect(line.req).toMatchObject({
      method: 'GET',
      url: '/orders?token=[Redacted]',
      headers: { 'user-agent': 'vitest' },
    });
    expect(line.req).not.toHaveProperty('query');
    expect(line).not.toHaveProperty(['res', 'headers', 'x-powered-by']);
  });

  it('logs a 500 at error, with the real error under the same request ID', async () => {
    const res = await request(app.getHttpServer()).get('/boom').expect(500);

    const reqId = res.headers['x-request-id'];
    expect(completed()[0]).toMatchObject({
      level: 'error',
      reqId,
      res: { statusCode: 500 },
    });
    expect(
      lines.find((line) => line.context === 'ExceptionsHandler'),
    ).toMatchObject({
      level: 'error',
      reqId,
      err: {
        message: 'kaput',
        stack: expect.stringContaining('kaput') as string,
      },
    });
  });

  it('redacts the query parameters of a failed database query', async () => {
    await request(app.getHttpServer()).get('/query-failed').expect(500);

    const line = lines.find((entry) => entry.context === 'ExceptionsHandler');
    expect(line?.err).toMatchObject({
      message: 'duplicate key',
      parameters: '[Redacted]',
    });
    expect(JSON.stringify(lines)).not.toContain('s3cret');
  });

  it('logs a 404 at warn', async () => {
    await request(app.getHttpServer()).get('/missing').expect(404);

    expect(completed()[0]).toMatchObject({
      level: 'warn',
      res: { statusCode: 404 },
    });
  });

  it('does not log a passing health probe', async () => {
    await request(app.getHttpServer()).get('/live').expect(200);

    expect(lines).toEqual([]);
  });
});
