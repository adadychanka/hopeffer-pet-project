import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { DomainError } from './domain-error.js';

export type InputSource = 'body' | 'headers' | 'path';

// Parses input with a zod schema. A failure throws validation_failed with one
// error per issue; the path starts with where the value came from
// (body.amountMinor, headers.idempotency-key).
export function parseInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
  source: InputSource,
): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new DomainError(
    'validation_failed',
    undefined,
    result.error.issues.map((issue) => ({
      path: [source, ...issue.path.map(String)].join('.'),
      message: issue.message,
    })),
  );
}

export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(
    private readonly schema: T,
    private readonly source: InputSource,
  ) {}

  transform(value: unknown): z.output<T> {
    return parseInput(this.schema, value, this.source);
  }
}
