import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { domainErrorFrom } from './constraint-errors.js';
import { DomainError, errorInfo, problemType } from './domain-error.js';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: { path: string; message: string }[];
}

export function problemFor(error: DomainError): ProblemDetails {
  const { status, title } = errorInfo(error.code);
  return {
    type: problemType(error.code),
    title,
    status,
    code: error.code,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.errors === undefined ? {} : { errors: error.errors }),
  };
}

// Answers business and validation errors as RFC 9457 problem details with a
// stable code. A BadRequestException comes from Nest's JSON body parser (the
// app validates with zod, which throws DomainError), and a
// PayloadTooLargeException from its size limit. Every other exception is left
// to Nest, so terminus /ready and unknown routes keep their usual bodies.
@Catch(
  DomainError,
  QueryFailedError,
  BadRequestException,
  PayloadTooLargeException,
)
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const problem = problemFor(this.toDomainError(exception));
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }

  private toDomainError(exception: unknown): DomainError {
    if (exception instanceof DomainError) {
      return exception;
    }
    if (exception instanceof BadRequestException) {
      return new DomainError(
        'validation_failed',
        'The request body is not valid JSON.',
        [{ path: 'body', message: 'Malformed JSON' }],
      );
    }
    if (exception instanceof PayloadTooLargeException) {
      return new DomainError('payload_too_large');
    }
    const mapped = domainErrorFrom(exception);
    if (mapped !== undefined) {
      return mapped;
    }
    this.logger.error({ msg: 'Unhandled database error', err: exception });
    return new DomainError('internal_error');
  }
}
