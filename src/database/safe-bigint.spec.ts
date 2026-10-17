import { describe, expect, it } from 'vitest';
import { parseSafeBigint, safeBigint } from './safe-bigint.js';

describe('safeBigint', () => {
  describe('to (write)', () => {
    it.each([
      0,
      1,
      -1,
      123_456,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
    ])('passes the safe integer %d through', (value) => {
      expect(safeBigint.to(value)).toBe(value);
    });

    it.each([null, undefined])('passes %s through', (value) => {
      expect(safeBigint.to(value)).toBe(value);
    });

    it.each([
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      -Number.MAX_SAFE_INTEGER - 1,
      Number.NaN,
    ])('rejects %d, which is not a safe integer', (value) => {
      expect(() => {
        safeBigint.to(value);
      }).toThrow(RangeError);
    });
  });

  describe('from (read)', () => {
    it('turns the pg string into a number', () => {
      expect(safeBigint.from('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
      expect(safeBigint.from('-42')).toBe(-42);
    });

    it('passes null through', () => {
      expect(safeBigint.from(null)).toBeNull();
    });

    it('rejects a value above the safe range instead of rounding it', () => {
      expect(() => {
        safeBigint.from('9007199254740992');
      }).toThrow(RangeError);
    });
  });
});

describe('parseSafeBigint', () => {
  it('parses a sum that pg returns as a string', () => {
    expect(parseSafeBigint('123')).toBe(123);
  });

  it('keeps null (SUM over no rows)', () => {
    expect(parseSafeBigint(null)).toBeNull();
  });

  it('rejects a sum outside the safe range', () => {
    expect(() => parseSafeBigint('-9007199254740992')).toThrow(RangeError);
  });
});
