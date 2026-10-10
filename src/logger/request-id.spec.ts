import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { requestId } from './request-id.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function call(header?: string | string[]) {
  const setHeader = vi.fn();
  const id = requestId(
    { headers: { 'x-request-id': header } } as unknown as IncomingMessage,
    { setHeader } as unknown as ServerResponse,
  );
  return { id, setHeader };
}

describe('requestId', () => {
  it('reuses a safe incoming ID and echoes it in the response', () => {
    const { id, setHeader } = call('01HZX3-abc_DEF.42');

    expect(id).toBe('01HZX3-abc_DEF.42');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', '01HZX3-abc_DEF.42');
  });

  it('creates a UUID when the request has no ID', () => {
    const { id, setHeader } = call();

    expect(id).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });

  it('creates a different UUID for each request', () => {
    expect(call().id).not.toBe(call().id);
  });

  it.each([
    ['an empty value', ''],
    ['a space', 'abc def'],
    ['a line break (log forging)', 'abc\n{"level":"fatal"}'],
    ['a quote', 'abc"def'],
    ['129 characters', 'a'.repeat(129)],
    // Node joins a repeated header with ", ".
    ['a repeated header', 'abc, def'],
    ['a list', ['abc', 'def']],
  ])('replaces an ID with %s', (_name, header) => {
    const { id, setHeader } = call(header);

    expect(id).toMatch(UUID);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });

  it('accepts an ID of exactly 128 characters', () => {
    expect(call('a'.repeat(128)).id).toBe('a'.repeat(128));
  });
});
