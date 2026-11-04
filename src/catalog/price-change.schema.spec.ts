import { describe, expect, it } from 'vitest';
import { lotIdParam, priceChangeBody } from './price-change.schema.js';

describe('priceChangeBody', () => {
  it('accepts a whole positive price up to the largest exact amount', () => {
    expect(priceChangeBody.parse({ unitPriceMinor: 1 })).toEqual({
      unitPriceMinor: 1,
    });
    expect(
      priceChangeBody.safeParse({ unitPriceMinor: Number.MAX_SAFE_INTEGER })
        .success,
    ).toBe(true);
  });

  it.each([0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 2])(
    'rejects %j',
    (unitPriceMinor) => {
      expect(priceChangeBody.safeParse({ unitPriceMinor }).success).toBe(false);
    },
  );

  it('rejects unknown fields', () => {
    expect(
      priceChangeBody.safeParse({ unitPriceMinor: 1, title: 'x' }).success,
    ).toBe(false);
  });
});

describe('lotIdParam', () => {
  it('requires a uuid', () => {
    expect(lotIdParam.safeParse('nope').success).toBe(false);
  });
});
