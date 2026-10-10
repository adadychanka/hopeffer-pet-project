import { DiscoveryService } from '@nestjs/core';
import type { HealthIndicatorResult } from '@nestjs/terminus';

// Marks a provider as a check for GET /ready. The argument is the key the
// check reports under, for example @ReadinessCheck('database'). HealthModule
// finds every marked provider at startup, so a module adds its check without
// a change to health code.
export const ReadinessCheck = DiscoveryService.createDecorator<string>();

// What a provider marked with @ReadinessCheck must implement.
export interface ReadinessIndicator {
  isHealthy(key: string): PromiseLike<HealthIndicatorResult>;
}

// A check that takes longer counts as down. The checks run in parallel, so
// /ready answers in about this time at worst. Set the probe timeout above it.
export const READINESS_TIMEOUT_MS = 1000;
