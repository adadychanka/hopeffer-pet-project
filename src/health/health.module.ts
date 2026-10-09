import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import type { Env } from '../config/env.js';
import { HealthController } from './health.controller.js';
import { ReadinessRegistry } from './readiness-registry.js';

// The only forRootAsync() of TerminusModule. Its HealthCheckService answers
// /ready, and after SIGTERM it reports shutting_down (503) for
// SHUTDOWN_DRAIN_MS before Nest closes the HTTP server. Infra modules import
// the static TerminusModule: they need only HealthIndicatorService.
@Module({
  imports: [
    TerminusModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        gracefulShutdownTimeoutMs: config.get('SHUTDOWN_DRAIN_MS', {
          infer: true,
        }),
      }),
    }),
    DiscoveryModule,
  ],
  controllers: [HealthController],
  providers: [ReadinessRegistry],
})
export class HealthModule {}
