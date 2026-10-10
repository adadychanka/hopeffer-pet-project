import { Logger, type LoggerService } from '@nestjs/common';

// Terminus reports a failed readiness check with logger.error(). A failed
// check is expected during an outage and is already visible as the 503 of
// /ready, so it must not page anyone: this logger writes it at warn. The line
// is kept because it is the only one that names the check that failed.
export class ReadinessLogger implements LoggerService {
  private readonly logger = new Logger('HealthCheck');

  log(message: unknown): void {
    this.logger.log(message);
  }

  warn(message: unknown): void {
    this.logger.warn(message);
  }

  error(message: unknown): void {
    this.logger.warn(message);
  }
}
