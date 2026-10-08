import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { HealthIndicatorFunction } from '@nestjs/terminus';
import { ReadinessCheck, type ReadinessIndicator } from './readiness.js';

// Collects the providers marked with @ReadinessCheck. Nest creates every
// provider before it calls onModuleInit, so all instances exist here. A
// mistake in a check stops the app at startup, not at the first probe.
/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class ReadinessRegistry implements OnModuleInit {
  private indicators: HealthIndicatorFunction[] = [];

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const keys = new Set<string>();
    this.indicators = this.discovery
      .getProviders({ metadataKey: ReadinessCheck.KEY })
      .map((wrapper) => {
        const key = this.discovery.getMetadataByDecorator(
          ReadinessCheck,
          wrapper,
        );
        // Without an argument, Nest stores {} as the metadata, not undefined.
        if (typeof key !== 'string' || key === '') {
          throw new Error(
            `${wrapper.name} has @ReadinessCheck() without a key`,
          );
        }
        if (keys.has(key)) {
          throw new Error(`Two readiness checks use the key "${key}"`);
        }
        const instance = wrapper.instance as
          Partial<ReadinessIndicator> | undefined;
        if (typeof instance?.isHealthy !== 'function') {
          throw new Error(
            `${wrapper.name} has @ReadinessCheck('${key}') but no isHealthy(key) method`,
          );
        }
        keys.add(key);
        const indicator = instance as ReadinessIndicator;
        return () => indicator.isHealthy(key);
      });
  }

  checks(): HealthIndicatorFunction[] {
    return this.indicators;
  }
}
