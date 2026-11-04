# Data Model: Marketplace Operations

This feature changes no table, column or rule. The schema is the one of feature 002: tables and columns in [`erd.md`](../001-marketplace-data-model/erd.md), named rules in [`schema-rules.md`](../002-marketplace-schema/contracts/schema-rules.md). This file lists what each operation reads and writes, the state changes it makes, and the checks the services add on top of the database rules.

## Rows written per operation

All writes of one operation share one transaction and one `now()` ([research R2, R8](./research.md)).

### Top up wallet

| Step | Table               | Write                                                                                                   |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| 1    | `accounts`          | lock the company wallet, bank clearing and, if an invoice is named, escrow                              |
| 2    | `invoices`, `deals` | if an invoice is named: lock it and its deal                                                            |
| 3    | `top_ups`           | `INSERT` company, amount, normalized bank reference, transfer date, invoice id or null, operator ref    |
| 4    | `ledger_transfers`  | `INSERT` type `top_up`, `top_up_id`, actor `operator`, `entry_count = 2`                                |
| 5    | `ledger_entries`    | bank clearing `-amount`, company wallet `+amount`, each with `balance_after_minor`                      |
| 6    | `accounts`          | both balances                                                                                           |
| 7    | (pay invoice)       | only if the invoice is `issued`, its deal's buyer is the company, and the new balance covers its amount |

### Pay invoice (shared by the top-up and by a purchase paid at once)

| Step | Table                 | Write                                                                                        |
| ---- | --------------------- | -------------------------------------------------------------------------------------------- |
| 1    | `ledger_transfers`    | `INSERT` type `invoice_payment`, `invoice_id`, the actor of the operation, `entry_count = 2` |
| 2    | `ledger_entries`      | buyer wallet `-amount`, escrow `+amount`                                                     |
| 3    | `accounts`            | both balances                                                                                |
| 4    | `invoices`            | `status = 'paid'`, `paid_at = now()`                                                         |
| 5    | `deals`               | `status = 'paid'`, `updated_at = now()`                                                      |
| 6    | `deal_status_changes` | `awaiting_payment` → `paid`, the actor of the operation                                      |

The actor is the operator for a top-up, and the buyer for a purchase paid at once.

### Update the price of a lot

| Step | Table               | Write                                                                       |
| ---- | ------------------- | --------------------------------------------------------------------------- |
| 1    | `lots`              | `SELECT … FOR UPDATE`                                                       |
| 2    | `lots`              | `unit_price_minor = new`, `updated_at = now()`                              |
| 3    | `lot_price_changes` | `INSERT` old price, new price, actor type `seller` or `operator`, actor ref |

### Buy a lot

| Step | Table                 | Write                                                                                                                                                                     |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `accounts`            | lock the buyer wallet and, if paying at once, escrow                                                                                                                      |
| 2    | `deals`               | look up `(buyer_company_id, idempotency_key)`; a hit ends the operation as a replay                                                                                       |
| 3    | `platform_settings`   | read the row                                                                                                                                                              |
| 4    | `deals`, `invoices`   | pay later only: count the buyer's `awaiting_payment` deals and the `expired` deals whose invoice expired within the look-back period                                      |
| 5    | `lots`                | conditional `UPDATE … SET stock_available = stock_available - q WHERE id = $1 AND status = 'published' AND stock_available >= q AND seller_company_id <> buyer RETURNING` |
| 6    | `deals`               | `INSERT` status `awaiting_payment`, unit price from step 5, `total_minor = q × price`, idempotency key                                                                    |
| 7    | `deal_status_changes` | `INSERT` `null` → `awaiting_payment`, actor `buyer`                                                                                                                       |
| 8    | `invoices`            | `INSERT` status `issued`, amount = total, `issued_at = now()`, `due_at`, `expires_at`; the number comes from `next_invoice_number()`                                      |
| 9    | (pay invoice)         | pay at once only; an `insufficient_balance` rejection rolls back steps 5–8                                                                                                |

## State changes

| Entity  | From               | To                 | Made by                                       |
| ------- | ------------------ | ------------------ | --------------------------------------------- |
| Deal    | (none)             | `awaiting_payment` | Buy a lot                                     |
| Deal    | `awaiting_payment` | `paid`             | Buy a lot paid at once; a top-up that pays it |
| Invoice | (none)             | `issued`           | Buy a lot                                     |
| Invoice | `issued`           | `paid`             | the same two                                  |
| Lot     | price X            | price Y ≠ X        | Update the price                              |
| Lot     | stock S            | stock S − q        | Buy a lot                                     |

No other transition is made by this feature. The other deal transitions of feature 001 stay unimplemented.

## Checks in the services

The database rejects bad rows (feature 002). The services check these rules first, so the caller gets a clear code ([contracts/http-api.md](./contracts/http-api.md#error-codes)), and they hold the rules the database cannot express:

| Rule                                                                       | Spec           | Database backstop                                                 |
| -------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------- |
| Amount, price and quantity are whole, positive, at most `MAX_SAFE_INTEGER` | FR-004         | `*_positive` checks; `safeBigint` throws above the range          |
| `q × price` is at most `MAX_SAFE_INTEGER`                                  | FR-004         | none (bigint holds it, JS does not)                               |
| Bank reference normalized, unique                                          | FR-007         | `top_ups_bank_reference_normalized`, `top_ups_bank_reference_key` |
| Company has a wallet                                                       | FR-009, FR-017 | the `*_company_id_fkey` keys to `accounts (company_id)`           |
| Named invoice is paid only if issued, same company, covered                | FR-010a        | `ledger_transfers_invoice_payment_key` (paid once)                |
| New price differs from the current price                                   | FR-013         | `lot_price_changes_price_changed`                                 |
| Only the lot's seller or an operator changes its price                     | FR-014         | none                                                              |
| Lot published, enough stock, buyer is not the seller                       | FR-017         | `lots_stock_not_negative`, `deals_buyer_not_seller`               |
| Unpaid limit and prepay-only rule                                          | FR-019         | none                                                              |
| Wallet and escrow never below 0                                            | FR-020         | `accounts_balance_not_negative`                                   |
| Transfer balances, entry count matches                                     | FR-005         | `ledger_transfers_balanced` (deferred)                            |
| Same idempotency key, same lot and quantity                                | FR-021         | `deals_buyer_idempotency_key_key`                                 |

## Invariants after every operation

The reconciliation queries of feature 001 ([data-model.md](../001-marketplace-data-model/data-model.md#invariants-and-where-they-are-enforced)) return no difference: every balance equals the sum of its entries, all balances sum to 0, and escrow equals the totals of deals in `paid`, `shipped` or `disputed`. The e2e tests run them after each money operation (SC-003).
