import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { crashMessage, crashReporter } from './logger/crash.js';

// Reads process.env, not ConfigService: this must work when the env validation
// is what failed.
const crash = crashReporter(process.env, {
  isTTY: Boolean(process.stdout.isTTY),
});
process.on('uncaughtException', (err, origin) =>
  crash(err, crashMessage(origin)),
);

async function bootstrap() {
  // By default Nest handles a failed start itself: it prints the buffered
  // logs as plain text and exits. abortOnError: false makes it throw instead,
  // and autoFlushLogs: false keeps the plain text off stdout, so the crash
  // reporter below writes the one fatal line.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    autoFlushLogs: false,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  app.flushLogs();
  // On SIGTERM, terminus answers /ready with 503 for SHUTDOWN_DRAIN_MS
  // (HealthModule). Then Nest closes the HTTP server, waits for requests in
  // flight, and runs onApplicationShutdown, where Postgres, Redis, S3 and
  // OpenSearch close. useProcessExit ends with process.exit(), so Pino's
  // transports flush.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}

try {
  await bootstrap();
} catch (err) {
  crash(err, 'Application failed to start');
}
