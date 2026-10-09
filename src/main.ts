import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // On SIGTERM, terminus answers /ready with 503 for SHUTDOWN_DRAIN_MS
  // (HealthModule). Then Nest closes the HTTP server, waits for requests in
  // flight, and runs onApplicationShutdown, where Postgres, Redis, S3 and
  // OpenSearch close. useProcessExit ends with process.exit(), so Pino's
  // transports flush.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
