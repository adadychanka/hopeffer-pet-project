import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

// Pretty output only for a developer terminal. Containers and CI get JSON lines.
const pretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level:
          process.env.LOG_LEVEL ??
          (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        transport: pretty
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
      },
    }),
  ],
})
export class LoggerModule {}
