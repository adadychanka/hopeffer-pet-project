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
});
