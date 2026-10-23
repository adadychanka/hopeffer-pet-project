import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES, type ErrorCode } from './domain-error.js';

describe('ERROR_CODES', () => {
  it('gives every code an HTTP error status and a title', () => {
    expect(ERROR_CODES.size).toBe(18);
    for (const { status, title } of ERROR_CODES.values()) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(title).not.toBe('');
    }
  });
});

describe('DomainError', () => {
  it('keeps the code, the detail and the field errors', () => {
    const errors = [{ path: 'body.quantity', message: 'Too small' }];
    const error = new DomainError('validation_failed', 'Bad body', errors);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainError');
    expect(error.code).toBe('validation_failed');
    expect(error.detail).toBe('Bad body');
    expect(error.errors).toBe(errors);
    expect(error.message).toBe('Bad body');
  });

  it('uses the title as the message without a detail', () => {
    const code: ErrorCode = 'own_lot';
    const error = new DomainError(code);

    expect(error.detail).toBeUndefined();
    expect(error.message).toBe('Cannot buy your own lot');
  });
});
