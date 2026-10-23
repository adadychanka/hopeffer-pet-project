# Contract: HTTP API

The three operations of this feature. Decisions behind the shape: [research.md](../research.md) R4–R9.

## Conventions

- Bodies are JSON (`Content-Type: application/json`). Unknown fields are rejected.
- Money is a JSON integer in minor units (cents), in a field that ends in `Minor`. Fractions and values above 9,007,199,254,740,991 are rejected.
- Ids are uuids. Times are ISO 8601 strings in UTC (`2026-03-01T10:00:00.000Z`). Dates are `YYYY-MM-DD`.
- Errors are RFC 9457 problem details (`Content-Type: application/problem+json`), see [Errors](#errors).

## Actor headers

Required on every request below, until the security feature replaces them (R5). They are trusted as sent: do not expose the API outside a trusted network.

| Header         | Required                         | Value                   |
| -------------- | -------------------------------- | ----------------------- |
| `X-Actor-Role` | always                           | `operator` or `company` |
| `X-Actor-Ref`  | always                           | 1–200 characters        |
| `X-Company-Id` | when `X-Actor-Role` is `company` | uuid                    |

`X-Company-Id` with `X-Actor-Role: operator` is a `400`.

## POST /top-ups

Records a bank notification and credits the company's wallet. If `invoiceId` names an `issued` invoice of the same company and the new balance covers it, the invoice is paid in the same step.

Roles: `operator`.

```json
{
  "companyId": "7c0e…",
  "amountMinor": 300000,
  "bankReference": "trx-2026 0301",
  "transferDate": "2026-03-01",
  "invoiceId": "a1f3…"
}
```

| Field           | Rule                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| `companyId`     | uuid                                                                                       |
| `amountMinor`   | integer, 1 to 9,007,199,254,740,991                                                        |
| `bankReference` | whitespace removed and upper-cased, then 1–140 characters of `A–Z 0–9 / ? : ( ) . , ' + -` |
| `transferDate`  | a real date, at most 1 day after today (UTC)                                               |
| `invoiceId`     | optional uuid                                                                              |

`201 Created`:

```json
{
  "topUp": {
    "id": "5b2d…",
    "companyId": "7c0e…",
    "amountMinor": 300000,
    "bankReference": "TRX-20260301",
    "transferDate": "2026-03-01",
    "invoiceId": "a1f3…",
    "recordedAt": "2026-03-01T10:00:00.000Z"
  },
  "walletBalanceMinor": 0,
  "paidInvoiceId": "a1f3…"
}
```

`paidInvoiceId` is `null` when no invoice was paid. `walletBalanceMinor` is the balance after the whole operation.

Errors: `validation_failed`, `forbidden_role`, `company_not_found`, `wallet_not_activated`, `invoice_not_found`, `bank_reference_already_recorded`.

## POST /lots/{lotId}/price-changes

Sets a new unit price. Existing deals and invoices keep their price.

Roles: `company` (acts as the seller; must be the lot's seller) or `operator`.

```json
{ "unitPriceMinor": 120000 }
```

| Field            | Rule                                |
| ---------------- | ----------------------------------- |
| `unitPriceMinor` | integer, 1 to 9,007,199,254,740,991 |

`201 Created`:

```json
{
  "id": "42",
  "lotId": "d9a0…",
  "oldPriceMinor": 100000,
  "newPriceMinor": 120000,
  "actorType": "seller",
  "changedAt": "2026-03-02T09:30:00.000Z"
}
```

`id` is a string: it is a `bigint` identity key.

Errors: `validation_failed`, `forbidden_role`, `lot_not_found`, `not_lot_seller`, `price_unchanged`.

A company that is not the seller gets `404 lot_not_found` for a hidden lot and `403 not_lot_seller` for a published one, so hidden lots stay invisible to other companies.

## POST /deals

Buys units of a lot. Without `payNow`, the deal waits for payment; with `payNow: true`, the invoice is paid from the buyer's wallet in the same step.

Roles: `company` (acts as the buyer).

Header `Idempotency-Key`: required, a uuid the client generates once per purchase and reuses on every retry of it.

```json
{ "lotId": "d9a0…", "quantity": 3, "payNow": false }
```

| Field      | Rule                            |
| ---------- | ------------------------------- |
| `lotId`    | uuid                            |
| `quantity` | integer, 1 to 2,147,483,647     |
| `payNow`   | optional boolean, default false |

`201 Created` for a new deal, `200 OK` with the header `Idempotent-Replayed: true` for a replay. Both carry the deal's current state:

```json
{
  "deal": {
    "id": "e44b…",
    "lotId": "d9a0…",
    "buyerCompanyId": "7c0e…",
    "sellerCompanyId": "1f9c…",
    "quantity": 3,
    "unitPriceMinor": 100000,
    "totalMinor": 300000,
    "status": "awaiting_payment",
    "createdAt": "2026-03-01T10:00:00.000Z"
  },
  "invoice": {
    "id": "a1f3…",
    "number": "INV-2026-000017",
    "amountMinor": 300000,
    "status": "issued",
    "issuedAt": "2026-03-01T10:00:00.000Z",
    "dueAt": "2026-03-06T10:00:00.000Z",
    "expiresAt": "2026-03-07T10:00:00.000Z",
    "paidAt": null
  }
}
```

Errors: `validation_failed`, `forbidden_role`, `company_not_found`, `wallet_not_activated`, `idempotency_key_reused`, `lot_not_found`, `own_lot`, `insufficient_stock`, `amount_too_large`, `unpaid_deal_limit_reached`, `prepay_only`, `insufficient_balance`.

The checks run in this order, and the first failing one answers: actor and body, buyer wallet, idempotency key, unpaid limit and prepay-only (pay later only), lot (`lot_not_found`, `own_lot`, `amount_too_large`, `insufficient_stock`), balance (pay at once only).

## Errors

```json
{
  "type": "about:blank",
  "title": "Insufficient stock",
  "status": 422,
  "code": "insufficient_stock",
  "detail": "The lot has 2 units available; 3 were requested."
}
```

`validation_failed` adds `errors`: a list of `{ "path": "body.amountMinor", "message": "…" }`.

### Error codes

| Code                              | Status | When                                                                                  | Database rule mapped to it                               |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `validation_failed`               | 400    | a header, path parameter or body field breaks its rule, or the body is not valid JSON | the `*_positive`, `*_format` checks                      |
| `payload_too_large`               | 413    | the body is larger than the JSON body parser accepts                                  | none                                                     |
| `forbidden_role`                  | 403    | the actor role may not call this operation                                            | none                                                     |
| `not_lot_seller`                  | 403    | a company changes the price of another company's published lot                        | none                                                     |
| `lot_not_found`                   | 404    | the lot does not exist, or it is hidden and the actor is not its seller               | `deals_lot_seller_fkey`                                  |
| `bank_reference_already_recorded` | 409    | a top-up with the same normalized reference exists                                    | `top_ups_bank_reference_key`                             |
| `price_unchanged`                 | 409    | the new price equals the current price                                                | `lot_price_changes_price_changed`                        |
| `company_not_found`               | 422    | the company in the body or `X-Company-Id` does not exist                              | none                                                     |
| `wallet_not_activated`            | 422    | the company exists but has no wallet                                                  | `top_ups_company_id_fkey`, `deals_buyer_company_id_fkey` |
| `invoice_not_found`               | 422    | the top-up names an invoice that does not exist                                       | `top_ups_invoice_id_fkey`                                |
| `idempotency_key_reused`          | 422    | the key belongs to a deal of another lot or quantity                                  | none                                                     |
| `own_lot`                         | 422    | the buyer is the lot's seller                                                         | `deals_buyer_not_seller`                                 |
| `insufficient_stock`              | 422    | the stock is lower than the quantity                                                  | `lots_stock_not_negative`                                |
| `amount_too_large`                | 422    | quantity × price is above 9,007,199,254,740,991                                       | none                                                     |
| `unpaid_deal_limit_reached`       | 422    | pay later, and the buyer has the limit of unpaid deals                                | none                                                     |
| `prepay_only`                     | 422    | pay later, and the buyer has the limit of recent expired deals                        | none                                                     |
| `insufficient_balance`            | 422    | pay at once, and the wallet does not cover the total                                  | `accounts_balance_not_negative`                          |
| `internal_error`                  | 500    | anything else; logged with `err`, no detail sent                                      | any unmapped rule                                        |

`deals_buyer_idempotency_key_key` is not mapped: the buyer wallet lock serializes a buyer's purchases, so a second request with the same key always finds the first deal and answers it as a replay (R9).
