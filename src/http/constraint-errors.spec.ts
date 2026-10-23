import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { constraintOf, domainErrorFrom } from './constraint-errors.js';
import { DomainError } from './domain-error.js';

function queryFailed(driverError: Record<string, unknown>): QueryFailedError {
  return new QueryFailedError(
    'INSERT ...',
    [],
    Object.assign(new Error('violation'), driverError),
  );
}

describe('constraintOf', () => {
  it('reads the rule name of a database error', () => {
    expect(constraintOf(queryFailed({ constraint: 'some_rule' }))).toBe(
      'some_rule',
    );
  });

  it('is undefined for a database error without a rule name', () => {
    expect(constraintOf(queryFailed({ code: '23502' }))).toBeUndefined();
  });

  it('is undefined for any other error', () => {
    expect(constraintOf(new Error('boom'))).toBeUndefined();
    expect(constraintOf('boom')).toBeUndefined();
  });
});

describe('domainErrorFrom', () => {
  it('maps a known rule to its code', () => {
    const error = domainErrorFrom(
      queryFailed({ constraint: 'top_ups_bank_reference_key' }),
    );

    expect(error).toBeInstanceOf(DomainError);
    expect(error?.code).toBe('bank_reference_already_recorded');
  });

  it('is undefined for an unknown rule and for other errors', () => {
    expect(
      domainErrorFrom(queryFailed({ constraint: 'unknown_rule' })),
    ).toBeUndefined();
    expect(domainErrorFrom(queryFailed({}))).toBeUndefined();
    expect(domainErrorFrom(new Error('boom'))).toBeUndefined();
  });
});
