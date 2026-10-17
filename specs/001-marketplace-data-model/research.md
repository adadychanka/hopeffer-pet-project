# Research: Marketplace Data Model

Decisions made before the data model was drawn. Each one resolves a question that the spec leaves to the design. The target database is PostgreSQL 17 (`postgres:17.11-alpine` in `docker-compose.yml`).

## R1. Ledger shape: double-entry with stored balances

- **Decision**: Every money movement is a `ledger_transfers` row with two or more `ledger_entries` rows. An entry holds a signed amount (positive = money into the account, negative = money out). The entries of one transfer sum to 0. `accounts.balance_minor` stores the current balance, and each entry stores `balance_after_minor`.
- **Rationale**: Double-entry makes SC-002 a single check (`SUM(balance_minor) = 0` over all accounts) and gives escrow and incoming bank money their own balances (SC-003). The stored balance is the row that a payment locks (`SELECT … FOR UPDATE`), so the "never below 0" check is a cheap `CHECK` on one row instead of a `SUM` over the history. `balance_after_minor` makes a statement readable without a window function and shows at once where a history broke.
- **Alternatives considered**:
  - Single-entry journal per wallet (the first spec draft): no place for escrow money, and "money is never created" cannot be checked.
  - Balance computed only from entries (no stored balance): correct by construction, but a payment has to lock something, and `SUM` over the history grows with every deal.
  - Separate debit and credit columns or a direction column with an unsigned amount: the same information as a signed amount, but every sum needs a `CASE`.

## R2. Platform accounts: escrow and bank clearing

- **Decision**: `accounts` has three types: `company_wallet` (one per company), `escrow` and `bank_clearing` (one row each). A top-up moves money from `bank_clearing` to a company wallet, so `bank_clearing` goes negative by the total money that entered the platform. Company wallets and escrow cannot go below 0; `bank_clearing` cannot go above 0.
- **Rationale**: Every transfer, including a top-up, has two sides, so the sum of all balances stays exactly 0. The negative `bank_clearing` balance equals the money the platform owes to companies, which is what the platform's real bank account must hold. That gives the operator a reconciliation check against the bank statement.
- **Alternatives considered**: A top-up with one entry and no counterpart: breaks the zero-sum rule and needs a special case in every check.

## R3. Transfer source: exclusive foreign keys, not a polymorphic id

- **Decision**: `ledger_transfers` has four nullable foreign keys: `top_up_id`, `invoice_id`, `deal_id`, `correction_id`. A `CHECK` requires exactly one of them (`num_nonnulls(...) = 1`), and another `CHECK` ties each to its transfer type.
- **Rationale**: Each source keeps a real foreign key, so a transfer cannot point to a missing row. Partial unique indexes then enforce the money rules in the database: one payment per invoice, one payout or refund per deal, one transfer per top-up and per correction.
- **Alternatives considered**: `source_type` + `source_id`: one column pair, but no foreign key and no per-type uniqueness.

## R4. Append-only ledger

- **Decision**: A trigger on `ledger_transfers` and `ledger_entries` rejects `UPDATE` and `DELETE`. The application's database role gets only `SELECT` and `INSERT` on them. A deferred constraint trigger checks at commit that the entries of each new transfer sum to 0 and that there are at least two of them.
- **Rationale**: FR-030 and FR-026 hold even when a bug or a manual query tries to break them. A deferred trigger is needed because the entries of one transfer are inserted one by one.
- **Alternatives considered**: Application checks only: a single missed code path breaks the ledger without a trace.

## R5. Settings: snapshot into the deal and the invoice

- **Decision**: `platform_settings` is a one-row table that the operator edits. At purchase the values are copied into the new rows: `invoices.due_at`, `invoices.expires_at`, and later `deals.confirmation_due_at`. Background jobs read only the copied values.
- **Rationale**: FR-024 says a settings change applies to new deals only. Snapshots make that true without a settings history, and a job needs one indexed column to find what is due.
- **Alternatives considered**: Settings in environment variables (`src/config/env.ts`): Constitution III covers deployment configuration, but the operator must change these values at run time, so they are business data. A settings history table: more than the spec needs.

## R6. Identifiers

- **Decision**: Business rows (`companies`, `accounts`, `lots`, `lot_photos`, `deals`, `invoices`, `ledger_transfers`, `top_ups`, `corrections`) use `uuid` keys with the default `gen_random_uuid()`. Append-only history rows (`ledger_entries`, `deal_status_changes`) use `bigint GENERATED ALWAYS AS IDENTITY`. Invoices also get a human number `INV-<year>-<6 digits>` from a sequence.
- **Rationale**: UUIDs can go into URLs and API responses without revealing volumes, and the application can create them before insert. An identity key on history rows gives a cheap, strict order for statements. PostgreSQL 17 has no built-in UUIDv7; switch the default to `uuidv7()` after moving to PostgreSQL 18.
- **Alternatives considered**: `bigint` keys everywhere: smaller indexes, but they reveal counts and need a second public id.
- **Risk**: a sequence can leave gaps after a rollback. These invoices are payment requests inside the platform, not tax documents. If tax law later requires gapless numbers, a locked counter row replaces the sequence.

## R7. Money columns

- **Decision**: `bigint` amounts in minor units, with the `_minor` suffix in the column name (`unit_price_minor`, `amount_minor`). No currency column (one currency, per the spec).
- **Rationale**: Integers are exact (FR-036), and `bigint` holds up to 92 trillion units in major currency, enough for heavy equipment. The suffix keeps "cents vs units" out of code review.
- **Alternatives considered**: `numeric(19,4)`: exact too, but slower, and the scale invites fractional cents. The PostgreSQL `money` type: depends on `lc_monetary`.
- **For the implementing feature**: the `pg` driver, and so TypeORM, returns `bigint` as a string, because a JS `number` loses precision above 2^53. Each money column needs a TypeORM transformer, to `number` (exact up to about 90 trillion minor units) or to `BigInt`. The API amount format (integer minor units, as Stripe does, or a decimal string) is decided there too.

## R8. Statuses: `text` with `CHECK`, not enum types

- **Decision**: Status and type columns are `text` with a `CHECK (status IN (...))` constraint.
- **Rationale**: Adding or removing a value is one `ALTER TABLE … DROP/ADD CONSTRAINT` in a reversible migration (Constitution IV). A PostgreSQL enum value cannot be removed, so `migration:revert` of an added value is not possible.
- **Alternatives considered**: PostgreSQL `ENUM` types: smaller storage, but irreversible changes.

## R9. Concurrency

- **Decision**:
  - Stock: a purchase reserves units with one conditional statement: `UPDATE lots SET stock_available = stock_available - $qty WHERE id = $id AND status = 'published' AND stock_available >= $qty`. Zero updated rows means rejection. The `CHECK (stock_available >= 0)` is the last guard.
  - Money and buyer limits: a purchase or payment locks the buyer's wallet row (`SELECT … FOR UPDATE`) first, then counts unpaid deals and expired deals, then moves money. Several accounts are locked in `id` order to avoid deadlocks.
  - Isolation level stays `READ COMMITTED`; the explicit locks above give the ordering.
- **Rationale**: Meets FR-016 and SC-004 without `SERIALIZABLE` retries. The wallet row is a natural per-buyer lock: every rule of FR-022 and FR-023 is per buyer.
- **Alternatives considered**: `SERIALIZABLE` isolation: correct, but every service call needs a retry loop. Optimistic version columns: same retry cost.

## R10. Deal keeps its seller, checked by a composite foreign key

- **Decision**: `deals.seller_company_id` is stored, and `(lot_id, seller_company_id)` references `lots (id, seller_company_id)`. `CHECK (buyer_company_id <> seller_company_id)` blocks buying one's own lot.
- **Rationale**: Seller reports and the own-lot rule need the seller on the deal. The composite foreign key makes it impossible for the copy to disagree with the lot.
- **Alternatives considered**: Join through `lots` every time: no rule for "buyer is not the seller" in the database.

## R11. Invoice is a separate table, one per deal

- **Decision**: `invoices` with `UNIQUE (deal_id)`.
- **Rationale**: The invoice has its own number, dates and statuses, and top-ups and transfers point to it. A separate table also leaves room for later needs (an invoice PDF, partial payments) without changing `deals`.
- **Alternatives considered**: Invoice columns on `deals`: one table less, but transfers and top-ups would point to a deal while the business talks about invoices.

## R12. Bank reference uniqueness

- **Decision**: `top_ups.bank_reference` is stored in its electronic format (upper case, all whitespace removed, SEPA reference characters only) with a `UNIQUE` constraint (changed by feature 002; it was trimmed and upper case).
- **Rationale**: "trx-1 ", "TRX-1\n" and "TRX-1" are the same bank transfer. Trimming only spaces lets tabs, newlines and non-breaking spaces through. Normalizing before the unique check is what makes FR-033 hold in practice.

## R13. Diagram files

- **Decision**: The Mermaid ERD lives in `data-model.md`. The draw.io ERD is `specs/001-marketplace-data-model/erd.drawio.svg`: an SVG picture with the uncompressed draw.io model in its `content` attribute, built the same way as the existing C4 diagrams. `docs/system-design/marketplace-v2/erd.drawio.svg` is a byte-identical copy (FR-039). The quickstart checks the copy with `cmp`.
- **Rationale**: One file is both the picture for a README and the editable source. The copy follows the user's choice in Clarifications; the `cmp` check catches drift.
- **Alternatives considered**: The v2 README links to the file in `specs/` instead of a copy: no drift possible, but the case folder is no longer self-contained.
