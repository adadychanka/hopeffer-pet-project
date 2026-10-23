import { describe, expect, it } from 'vitest';
import { parseActor } from './actor.js';
import { DomainError } from './domain-error.js';

const companyId = '7c0e8f9a-1b2c-4d3e-8f4a-5b6c7d8e9f0a';

function failureOf(work: () => unknown): DomainError {
  try {
    work();
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected a failure');
}

describe('parseActor', () => {
  it('reads an operator', () => {
    expect(
      parseActor(
        { 'x-actor-role': 'operator', 'x-actor-ref': 'op-1', host: 'x' },
        ['operator'],
      ),
    ).toEqual({ role: 'operator', ref: 'op-1' });
  });

  it('reads a person acting for a company', () => {
    expect(
      parseActor(
        {
          'x-actor-role': 'company',
          'x-actor-ref': 'person-1',
          'x-company-id': companyId,
        },
        ['company', 'operator'],
      ),
    ).toEqual({ role: 'company', ref: 'person-1', companyId });
  });

  it.each([
    [{}, 'headers.x-actor-role'],
    [{ 'x-actor-role': 'admin', 'x-actor-ref': 'a' }, 'headers.x-actor-role'],
    [{ 'x-actor-role': 'operator' }, 'headers.x-actor-ref'],
    [{ 'x-actor-role': 'operator', 'x-actor-ref': '' }, 'headers.x-actor-ref'],
    [
      { 'x-actor-role': 'operator', 'x-actor-ref': 'a'.repeat(201) },
      'headers.x-actor-ref',
    ],
    [
      {
        'x-actor-role': 'operator',
        'x-actor-ref': 'a',
        'x-company-id': companyId,
      },
      'headers.x-company-id',
    ],
    [{ 'x-actor-role': 'company', 'x-actor-ref': 'a' }, 'headers.x-company-id'],
    [
      { 'x-actor-role': 'company', 'x-actor-ref': 'a', 'x-company-id': 'nope' },
      'headers.x-company-id',
    ],
  ])('rejects %j at %s', (headers, path) => {
    const error = failureOf(() => parseActor(headers, ['operator', 'company']));

    expect(error.code).toBe('validation_failed');
    expect(error.errors?.map((e) => e.path)).toContain(path);
  });

  it('rejects a role the operation does not accept', () => {
    const error = failureOf(() =>
      parseActor({ 'x-actor-role': 'operator', 'x-actor-ref': 'op-1' }, [
        'company',
      ]),
    );

    expect(error.code).toBe('forbidden_role');
    expect(error.detail).toBe('This operation accepts the roles: company.');
  });
});
