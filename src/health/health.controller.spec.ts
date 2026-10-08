import { describe, expect, it } from 'vitest';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
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
    imports: [HealthModule],
    providers: indicators,
  }).compile();
  moduleRef.useLogger(false);
  await moduleRef.init();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('live() reports ok and runs no checks', async () => {
    const controller = await controllerWith(FailingIndicator);

    expect(await controller.live()).toEqual({
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
});
