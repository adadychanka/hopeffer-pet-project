import { describe, expect, it } from 'vitest';
import { purchaseBody, purchaseHeaders } from './purchase.schema.js';

const lotId = '7c0e8f9a-1b2c-4d3e-8f4a-5b6c7d8e9f0a';

describe('purchaseBody', () => {
  it('defaults payNow to false', () => {
    expect(purchaseBody.parse({ lotId, quantity: 3 })).toEqual({
      lotId,
      quantity: 3,
      payNow: false,
    });
  });

  it.each([0, -1, 1.5, '3', 2_147_483_648])(
    'rejects the quantity %j',
    (quantity) => {
      expect(purchaseBody.safeParse({ lotId, quantity }).success).toBe(false);
    },
  );

  it('accepts the largest quantity and rejects unknown fields', () => {
    expect(
      purchaseBody.safeParse({ lotId, quantity: 2_147_483_647 }).success,
    ).toBe(true);
    expect(
      purchaseBody.safeParse({ lotId, quantity: 1, price: 1 }).success,
    ).toBe(false);
  });
});

describe('purchaseHeaders', () => {
  it('requires a uuid key', () => {
    expect(
      purchaseHeaders.safeParse({ 'idempotency-key': lotId }).success,
    ).toBe(true);
    expect(
      purchaseHeaders.safeParse({ 'idempotency-key': 'key-1' }).success,
    ).toBe(false);
    expect(purchaseHeaders.safeParse({}).success).toBe(false);
  });
});
