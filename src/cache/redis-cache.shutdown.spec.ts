import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createCache } from 'cache-manager';
import { get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RedisCacheShutdown } from './redis-cache.shutdown.js';

const events: string[] = [];

@Controller()
class SlowController {
  @Get('slow')
  async slow(): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    events.push('response');
    return 'ok';
  }
}

// agent: false sends the request without keep-alive, so the server can close
// as soon as the response is sent.
function request(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, { agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    }).on('error', reject);
  });
}

describe('RedisCacheShutdown', () => {
  afterEach(() => {
    events.length = 0;
  });

  it('disconnects the cache only after requests in flight have finished', async () => {
    const cache = createCache();
    vi.spyOn(cache, 'disconnect').mockImplementation(() => {
      events.push('disconnect');
      return Promise.resolve(undefined);
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [SlowController],
      providers: [
        { provide: CACHE_MANAGER, useValue: cache },
        RedisCacheShutdown,
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;

    const response = request(`http://127.0.0.1:${port}/slow`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.close();

    expect(await response).toBe(200);
    expect(events).toEqual(['response', 'disconnect']);
  });
});
