import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError } from './domain-error.js';
import { parseInput, ZodValidationPipe } from './zod-validation.pipe.js';

const schema = z.strictObject({
  amountMinor: z.int().positive(),
  note: z.string().transform((value) => value.trim()),
});

function failureOf(work: () => unknown): DomainError {
  try {
    work();
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected a failure');
}

describe('parseInput', () => {
  it('returns the parsed value, with transforms applied', () => {
    expect(
      parseInput(schema, { amountMinor: 5, note: ' hi ' }, 'body'),
    ).toEqual({
      amountMinor: 5,
      note: 'hi',
    });
  });

  it('throws validation_failed with one error per issue, prefixed by the source', () => {
    const error = failureOf(() =>
      parseInput(schema, { amountMinor: 1.5, note: 'x', extra: 1 }, 'body'),
    );

    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('validation_failed');
    expect(error.errors?.map((e) => e.path)).toEqual(
      expect.arrayContaining(['body.amountMinor', 'body']),
    );
  });

  it('prefixes header issues with headers', () => {
    const error = failureOf(() =>
      parseInput(z.object({ 'idempotency-key': z.uuid() }), {}, 'headers'),
    );

    expect(error.errors?.[0].path).toBe('headers.idempotency-key');
  });
});

describe('ZodValidationPipe', () => {
  it('parses through parseInput', () => {
    const pipe = new ZodValidationPipe(z.uuid(), 'path');

    expect(() => pipe.transform('nope')).toThrow(DomainError);
    expect(failureOf(() => pipe.transform('nope')).errors?.[0].path).toBe(
      'path',
    );
    const id = '7c0e8f9a-1b2c-4d3e-8f4a-5b6c7d8e9f0a';
    expect(pipe.transform(id)).toBe(id);
  });
});
