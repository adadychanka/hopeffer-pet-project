import { describe, expect, it } from 'vitest';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';
import { HealthModule } from './health.module.js';
import { ReadinessCheck, type ReadinessIndicator } from './readiness.js';

@ReadinessCheck('healthy')
@Injectable()
class HealthyIndicator implements ReadinessIndicator {
  isHealthy(key: string): Promise<HealthIndicatorResult> {
    return Promise.resolve({ [key]: { status: 'up' } });
  }
}

@ReadinessCheck('failing')
@Injectable()
class FailingIndicator implements ReadinessIndicator {
  isHealthy(key: string): Promise<HealthIndicatorResult> {
    return Promise.resolve({ [key]: { status: 'down', message: 'refused' } });
  }
}

async function controllerWith(
  ...indicators: (typeof HealthyIndicator | typeof FailingIndicator)[]
): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      HealthModule,
    ],
    providers: indicators,
  }).compile();
  moduleRef.useLogger(false);
  await moduleRef.init();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('live() reports ok and runs no checks', async () => {
    const controller = await controllerWith(FailingIndicator);

    expect(controller.live()).toEqual({
      status: 'ok',
      info: {},
      error: {},
      details: {},
    });
  });

  it('ready() reports ok when every registered check is up', async () => {
    const controller = await controllerWith(HealthyIndicator);

    expect(await controller.ready()).toMatchObject({
      status: 'ok',
      details: { healthy: { status: 'up' } },
    });
  });

  it('ready() throws 503 with the failed check when one check is down', async () => {
    const controller = await controllerWith(HealthyIndicator, FailingIndicator);

    const error = await controller.ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      status: 'error',
      info: { healthy: { status: 'up' } },
      error: { failing: { status: 'down', message: 'refused' } },
    });
  });

  it('live() keeps reporting ok after shutdown has started, while ready() reports shutting_down', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        HealthModule,
      ],
      providers: [HealthyIndicator],
    }).compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    const controller = moduleRef.get(HealthController);

    // close() runs beforeApplicationShutdown, where terminus marks itself as
    // shutting down. SHUTDOWN_DRAIN_MS is unset, so it does not wait.
    await moduleRef.close();

    expect(controller.live()).toEqual({
      status: 'ok',
      info: {},
      error: {},
      details: {},
    });
    const error = await controller.ready().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
      status: 'shutting_down',
    });
  });
});
