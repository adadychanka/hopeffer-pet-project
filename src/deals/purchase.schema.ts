import { z } from 'zod';

// The largest value of the integer column deals.quantity.
const MAX_QUANTITY = 2_147_483_647;

export const purchaseBody = z.strictObject({
  lotId: z.uuid(),
  quantity: z.int().min(1).max(MAX_QUANTITY),
  payNow: z.boolean().default(false),
});

export type PurchaseBody = z.output<typeof purchaseBody>;

// The key the buyer's client generates once per purchase and sends again on
// every retry of it (IETF Idempotency-Key header).
export const purchaseHeaders = z.object({
  'idempotency-key': z.uuid(),
});
