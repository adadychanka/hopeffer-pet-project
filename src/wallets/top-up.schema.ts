import { z } from 'zod';

const DAY_MS = 24 * 60 * 60 * 1000;

// A bank reference in its electronic format: all whitespace removed and
// upper case, so one notification is recorded once however it was typed
// (FR-007).
export function normalizeBankReference(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

// A real calendar date, at most one day after today in UTC: a bank in a time
// zone ahead of UTC can already be on the next day.
export function isAcceptedTransferDate(
  value: string,
  now = new Date(),
): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return false;
  }
  const tomorrow = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  return value <= tomorrow;
}

export const topUpBody = z.strictObject({
  companyId: z.uuid(),
  amountMinor: z.int().positive().max(Number.MAX_SAFE_INTEGER),
  bankReference: z
    .string()
    .transform(normalizeBankReference)
    // SEPA allows 140 characters of unstructured remittance information; the
    // characters are those top_ups_bank_reference_normalized allows.
    .pipe(
      z
        .string()
        .min(1)
        .max(140)
        .regex(/^[A-Z0-9/?:().,'+-]+$/, "Only A-Z 0-9 / ? : ( ) . , ' + -"),
    ),
  transferDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((value) => isAcceptedTransferDate(value), {
      message: 'A real date, at most 1 day after today (UTC)',
    }),
  invoiceId: z.uuid().optional(),
});

export type TopUpBody = z.output<typeof topUpBody>;
