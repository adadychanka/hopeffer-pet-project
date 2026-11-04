import { QueryFailedError } from 'typeorm';
import { DomainError, type ErrorCode } from './domain-error.js';

// Database rules that a race can still break after a service checked them
// (for example two top-ups with one bank reference at the same time). A
// violation answers the same code as the service's own check, so the caller
// sees one error whichever side caught it. Rule names are listed in
// specs/002-marketplace-schema/contracts/schema-rules.md.
export const CONSTRAINT_CODES: ReadonlyMap<string, ErrorCode> = new Map<
  string,
  ErrorCode
>([
  ['top_ups_bank_reference_key', 'bank_reference_already_recorded'],
  ['lot_price_changes_price_changed', 'price_unchanged'],
  ['top_ups_company_id_fkey', 'wallet_not_activated'],
  ['deals_buyer_company_id_fkey', 'wallet_not_activated'],
  ['top_ups_invoice_id_fkey', 'invoice_not_found'],
  ['deals_buyer_not_seller', 'own_lot'],
  ['deals_lot_seller_fkey', 'lot_not_found'],
  ['lots_stock_not_negative', 'insufficient_stock'],
  ['accounts_balance_not_negative', 'insufficient_balance'],
]);

export function constraintOf(error: unknown): string | undefined {
  if (!(error instanceof QueryFailedError)) {
    return undefined;
  }
  const driverError = error.driverError as { constraint?: unknown };
  return typeof driverError.constraint === 'string'
    ? driverError.constraint
    : undefined;
}

export function domainErrorFrom(error: unknown): DomainError | undefined {
  const constraint = constraintOf(error);
  const code =
    constraint === undefined ? undefined : CONSTRAINT_CODES.get(constraint);
  return code === undefined ? undefined : new DomainError(code);
}
