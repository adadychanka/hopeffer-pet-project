import {
  type ArgumentsHost,
  BadRequestException,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from './domain-error.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';

function fakeHost() {
  const response = {
    status: vi.fn(),
    type: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function answer(exception: unknown) {
  const { host, response } = fakeHost();
  new ProblemDetailsFilter().catch(exception, host);
  expect(response.type).toHaveBeenCalledWith('application/problem+json');
  return {
    status: response.status.mock.calls[0][0] as number,
    body: response.json.mock.calls[0][0] as Record<string, unknown>,
  };
}

function queryFailed(constraint?: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT ...',
    [],
    Object.assign(new Error('violation'), { constraint }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProblemDetailsFilter', () => {
  it('answers a DomainError with its status, title and code', () => {
    expect(answer(new DomainError('insufficient_stock', '2 left'))).toEqual({
      status: 422,
      body: {
        type: 'about:blank',
        title: 'Insufficient stock',
        status: 422,
        code: 'insufficient_stock',
        detail: '2 left',
      },
    });
  });

  it('keeps the field errors of a validation error', () => {
    const errors = [{ path: 'body.quantity', message: 'Too small' }];
    const { status, body } = answer(
      new DomainError('validation_failed', undefined, errors),
    );

    expect(status).toBe(400);
    expect(body).not.toHaveProperty('detail');
    expect(body.errors).toEqual(errors);
  });

  it('answers malformed JSON from the body parser as validation_failed', () => {
    const { status, body } = answer(
      new BadRequestException('Unexpected token'),
    );

    expect(status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.errors).toEqual([{ path: 'body', message: 'Malformed JSON' }]);
  });

  it('answers a too large body as payload_too_large', () => {
    const { status, body } = answer(new PayloadTooLargeException());

    expect(status).toBe(413);
    expect(body.code).toBe('payload_too_large');
  });

  it('maps a known database rule to its code', () => {
    const { status, body } = answer(queryFailed('top_ups_bank_reference_key'));

    expect(status).toBe(409);
    expect(body.code).toBe('bank_reference_already_recorded');
  });

  it('answers an unknown database rule as internal_error and logs it', () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const error = queryFailed('unknown_rule');

    const { status, body } = answer(error);

    expect(status).toBe(500);
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Internal error',
      status: 500,
      code: 'internal_error',
    });
    expect(log).toHaveBeenCalledWith({
      msg: 'Unhandled database error',
      err: error,
    });
  });
});
