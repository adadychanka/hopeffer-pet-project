import { describe, expect, it } from 'vitest';
import { Injectable, type Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { ReadinessCheck, type ReadinessIndicator } from './readiness.js';
import { ReadinessRegistry } from './readiness-registry.js';

function up(key: string): Promise<HealthIndicatorResult> {
  return Promise.resolve({ [key]: { status: 'up' } });
}

@ReadinessCheck('first')
@Injectable()
class FirstIndicator implements ReadinessIndicator {
  isHealthy = up;
}

@ReadinessCheck('second')
@Injectable()
class SecondIndicator implements ReadinessIndicator {
  isHealthy = up;
}

@ReadinessCheck('first')
@Injectable()
class DuplicateKeyIndicator implements ReadinessIndicator {
  isHealthy = up;
}

@ReadinessCheck()
@Injectable()
class NoKeyIndicator implements ReadinessIndicator {
  isHealthy = up;
}

@ReadinessCheck('broken')
@Injectable()
class NoMethodIndicator {}

@Injectable()
class UnmarkedService {
  isHealthy = up;
}

async function registryWith(...providers: Type[]): Promise<ReadinessRegistry> {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [ReadinessRegistry, ...providers],
  }).compile();
  await moduleRef.init();
  return moduleRef.get(ReadinessRegistry);
}

async function run(registry: ReadinessRegistry) {
  return Promise.all(
    registry.checks().map((check) => (check as () => Promise<unknown>)()),
  );
}

describe('ReadinessRegistry', () => {
  it('collects every provider marked with @ReadinessCheck, called with its key', async () => {
    const registry = await registryWith(
      FirstIndicator,
      SecondIndicator,
      UnmarkedService,
    );

    expect(await run(registry)).toEqual(
      expect.arrayContaining([
        { first: { status: 'up' } },
        { second: { status: 'up' } },
      ]),
    );
    expect(registry.checks()).toHaveLength(2);
  });

  it('has no checks when no provider is marked', async () => {
    const registry = await registryWith(UnmarkedService);

    expect(registry.checks()).toEqual([]);
  });

  it('refuses to start when two checks use the same key', async () => {
    await expect(
      registryWith(FirstIndicator, DuplicateKeyIndicator),
    ).rejects.toThrow('Two readiness checks use the key "first"');
  });

  it('refuses to start when a check has no key', async () => {
    await expect(registryWith(NoKeyIndicator)).rejects.toThrow(
      'NoKeyIndicator has @ReadinessCheck() without a key',
    );
  });

  it('refuses to start when a marked provider has no isHealthy method', async () => {
    await expect(registryWith(NoMethodIndicator)).rejects.toThrow(
      "NoMethodIndicator has @ReadinessCheck('broken') but no isHealthy(key) method",
    );
  });
});
