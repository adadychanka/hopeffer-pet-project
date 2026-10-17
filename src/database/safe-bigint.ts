import type { ValueTransformer } from 'typeorm';

// PostgreSQL bigint columns (money in minor units, identity keys) map to a JS
// number. pg returns bigint as a string, because a number loses precision
// above 2^53. Every value outside the safe integer range fails loudly instead
// of being rounded.

function assertSafe(value: number, source: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `bigint value ${source} is outside the safe integer range`,
    );
  }
  return value;
}

// For raw query results, such as SUM(amount_minor), which PostgreSQL returns as
// numeric and pg as a string.
export function parseSafeBigint(value: string | null): number | null {
  return value === null ? null : assertSafe(Number(value), value);
}

export const safeBigint: ValueTransformer = {
  to: (value: number | null | undefined) =>
    value === null || value === undefined
      ? value
      : assertSafe(value, String(value)),
  from: (value: string | null) => parseSafeBigint(value),
};
