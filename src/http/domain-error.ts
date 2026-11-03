// The stable error codes of the API (contracts/http-api.md of feature 003).
// Clients branch on the code; people read the title and the detail.
const ERROR_TABLE = {
  validation_failed: { status: 400, title: 'Validation failed' },
  forbidden_role: { status: 403, title: 'Role not allowed' },
  not_lot_seller: { status: 403, title: 'Not the seller of this lot' },
  lot_not_found: { status: 404, title: 'Lot not found' },
  bank_reference_already_recorded: {
    status: 409,
    title: 'Bank reference already recorded',
  },
  price_unchanged: { status: 409, title: 'Price unchanged' },
  payload_too_large: { status: 413, title: 'Payload too large' },
  company_not_found: { status: 422, title: 'Company not found' },
  wallet_not_activated: { status: 422, title: 'Wallet not activated' },
  invoice_not_found: { status: 422, title: 'Invoice not found' },
  idempotency_key_reused: { status: 422, title: 'Idempotency key reused' },
  own_lot: { status: 422, title: 'Cannot buy your own lot' },
  insufficient_stock: { status: 422, title: 'Insufficient stock' },
  amount_too_large: { status: 422, title: 'Amount too large' },
  unpaid_deal_limit_reached: {
    status: 422,
    title: 'Too many unpaid deals',
  },
  prepay_only: { status: 422, title: 'Prepayment required' },
  insufficient_balance: { status: 422, title: 'Insufficient balance' },
  internal_error: { status: 500, title: 'Internal error' },
} as const satisfies Record<string, { status: number; title: string }>;

export type ErrorCode = keyof typeof ERROR_TABLE;

export interface ErrorInfo {
  status: number;
  title: string;
}

// A Map, so a lookup by code is not a dynamic property access.
export const ERROR_CODES: ReadonlyMap<ErrorCode, ErrorInfo> = new Map(
  Object.entries(ERROR_TABLE) as [ErrorCode, ErrorInfo][],
);

export function errorInfo(code: ErrorCode): ErrorInfo {
  return ERROR_CODES.get(code) as ErrorInfo;
}

// RFC 9457 identifies a problem type by URI. Each code has its own, built
// from the code, so the title describes the type. The URI is an identifier:
// it does not have to resolve, but it must never change.
export const PROBLEM_TYPE_BASE = 'https://hopeffer.example/problems/';

export function problemType(code: ErrorCode): string {
  return PROBLEM_TYPE_BASE + code.replaceAll('_', '-');
}

export interface FieldError {
  path: string;
  message: string;
}

// A rejection by a business or validation rule. The filter answers it as RFC
// 9457 problem details.
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? errorInfo(code).title);
    this.name = 'DomainError';
  }
}
