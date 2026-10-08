import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { ReadinessRegistry } from './readiness-registry.js';

// Infra modules import the static TerminusModule too. Never use forRoot():
// a dynamic module would create a second terminus instance.
@Module({
  imports: [TerminusModule, DiscoveryModule],
  controllers: [HealthController],
  providers: [ReadinessRegistry],
})
export class HealthModule {}
