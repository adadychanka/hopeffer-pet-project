import { describe, expect, it } from 'vitest';
import {
  isAcceptedTransferDate,
  normalizeBankReference,
  topUpBody,
} from './top-up.schema.js';

const companyId = '7c0e8f9a-1b2c-4d3e-8f4a-5b6c7d8e9f0a';

function body(overrides: Record<string, unknown> = {}) {
  return {
    companyId,
    amountMinor: 300_000,
    bankReference: 'TRX-1',
    transferDate: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

describe('normalizeBankReference', () => {
  it('removes all whitespace and upper-cases', () => {
    expect(normalizeBankReference(' trx -2026\t03 01\n')).toBe('TRX-20260301');
  });
});

describe('isAcceptedTransferDate', () => {
  const now = new Date('2026-03-01T22:00:00.000Z');

  it('accepts today, tomorrow and a leap day', () => {
    expect(isAcceptedTransferDate('2026-03-01', now)).toBe(true);
    expect(isAcceptedTransferDate('2026-03-02', now)).toBe(true);
    expect(isAcceptedTransferDate('2024-02-29', now)).toBe(true);
  });

  it('rejects the day after tomorrow and dates that do not exist', () => {
    expect(isAcceptedTransferDate('2026-03-03', now)).toBe(false);
    expect(isAcceptedTransferDate('2026-02-29', now)).toBe(false);
    expect(isAcceptedTransferDate('2026-13-01', now)).toBe(false);
  });
});

describe('topUpBody', () => {
  it('normalizes the bank reference', () => {
    expect(
      topUpBody.parse(body({ bankReference: ' trx 1 ' })).bankReference,
    ).toBe('TRX1');
  });

  it('accepts an optional invoice id', () => {
    expect(topUpBody.parse(body({ invoiceId: companyId })).invoiceId).toBe(
      companyId,
    );
    expect(topUpBody.parse(body()).invoiceId).toBeUndefined();
  });

  it.each([
    { amountMinor: 0 },
    { amountMinor: 1.5 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 2 },
    { bankReference: '' },
    { bankReference: 'TRX_1' },
    { bankReference: 'A'.repeat(141) },
    { transferDate: '01.03.2026' },
    { transferDate: '2026-02-30' },
    { companyId: 'nope' },
    { extra: true },
  ])('rejects %j', (overrides) => {
    expect(topUpBody.safeParse(body(overrides)).success).toBe(false);
  });
});
