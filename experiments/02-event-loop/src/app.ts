import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HeavyService } from './heavy.service.js';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  // Closes the server and the thread pool on SIGTERM and SIGINT.
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  const heavy = app.get(HeavyService);
  console.log(
    JSON.stringify({
      event: 'listening',
      pid: process.pid,
      port,
      mode: heavy.mode,
      poolThreads: heavy.poolThreads,
    }),
  );
}
