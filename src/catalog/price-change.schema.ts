import { z } from 'zod';

export const priceChangeBody = z.strictObject({
  unitPriceMinor: z.int().positive().max(Number.MAX_SAFE_INTEGER),
});

export type PriceChangeBody = z.output<typeof priceChangeBody>;

export const lotIdParam = z.uuid();
