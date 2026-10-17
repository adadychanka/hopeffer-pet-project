# Marketplace data model: tables and fields

This file explains the ERD next to it (`erd.drawio.svg`): what each table is for, what each column means, and which normal form each table meets and why. The same file sits next to every copy of the ERD:

- `docs/architecture/erd.md`
- `docs/system-design/marketplace-v2/erd.md`
- `specs/001-marketplace-data-model/erd.md`

The copies are identical. Change all three together, and check them with `cmp`.

The full rules (every constraint with its name) are in `specs/002-marketplace-schema/contracts/schema-rules.md`. The design reasons are in `specs/001-marketplace-data-model/data-model.md`. The schema itself is built by the migrations in `src/database/migrations/`.

## Conventions

- **Keys.** Business rows use a `uuid` key that the database generates (`gen_random_uuid()`). History and ledger rows (`lot_price_changes`, `deal_status_changes`, `ledger_entries`) use an identity `bigint`, so the key also gives the order in which rows were written.
- **Money.** Columns that end in `_minor` hold an amount as a `bigint` of minor units (cents). One currency, no fractions. The application reads them as a JavaScript `number`, exact up to 9,007,199,254,740,991.
- **Time.** All times are `timestamptz`. `created_at` and `updated_at` are set automatically.
- **Who did it.** `actor_type` is `buyer`, `seller`, `operator` or `system`. `actor_ref`, `operator_ref` and `updated_by_ref` are opaque references to a person, until the security feature adds users. A `system` actor (a background job) has no reference.
- **Companies and wallets.** Columns named `*_company_id` hold a company id, but outside `accounts` they point at the company's wallet (`accounts.company_id`). So a company must have a wallet before it sells, buys, or gets a top-up or correction.
- **Append-only tables.** `lot_price_changes`, `deal_status_changes`, `ledger_transfers` and `ledger_entries` are never updated. Triggers reject changes. History rows are added, never rewritten.

## Normal forms

| Table                 | Normal form | Candidate keys                                                                               |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `companies`           | BCNF        | `id`; `registration_number`; `lower(email)`                                                  |
| `accounts`            | BCNF        | `id`; `company_id` (wallets); `type` (platform accounts)                                     |
| `lots`                | BCNF        | `id`                                                                                         |
| `lot_photos`          | BCNF        | `id`; `storage_key`; `(lot_id, position)`                                                    |
| `lot_price_changes`   | BCNF        | `id`                                                                                         |
| `deals`               | **2NF**     | `id`; `(buyer_company_id, idempotency_key)`                                                  |
| `deal_status_changes` | BCNF        | `id`                                                                                         |
| `invoices`            | BCNF        | `id`; `deal_id`; `number`                                                                    |
| `ledger_transfers`    | BCNF        | `id`; `top_up_id`; `correction_id`; `invoice_id` (payments); `deal_id` (payouts and refunds) |
| `ledger_entries`      | BCNF        | `id`                                                                                         |
| `top_ups`             | BCNF        | `id`; `bank_reference`                                                                       |
| `corrections`         | BCNF        | `id`; `idempotency_key`                                                                      |
| `platform_settings`   | BCNF        | `id` (one row)                                                                               |

A short reminder of the terms:

- **1NF**: every column holds one value. No arrays, lists or repeated groups.
- **2NF**: 1NF, and no column depends on only part of a composite key.
- **3NF**: 2NF, and no column depends on another non-key column (no transitive dependency).
- **BCNF**: every functional dependency starts from a candidate key. Only a key decides any other value in the row.

All 13 tables are in 1NF: every column is a single value, with no arrays or JSON. All are in 2NF: no column depends on part of a composite key. Twelve tables are in BCNF. `deals` stops at 2NF on purpose (below).

### Why BCNF

The tables are written by a transactional service (OLTP): purchases, payments, payouts, corrections. In that kind of system, a value stored in two places can drift apart, and a drifted money or ownership value is a real bug. BCNF means each fact is stored once, in the row of the thing it describes, so an update changes one row and cannot leave a stale copy behind. It also avoids the classic anomalies: a company's email is not repeated on its lots, so changing it is one update; deleting a deal cannot remove the only record of a lot's price.

### Why BCNF is enough

The normal forms above BCNF deal with problems this schema does not have:

- **4NF** removes independent multi-valued facts stored in one table (for example "a lot has colours" and "a lot has sizes" in the same rows). No table here stores two independent lists. Photos, price changes, status changes and ledger entries each have their own table.
- **5NF** removes join dependencies, where a table can only be rebuilt by joining three or more projections of it. No table here is such a combination of independent many-to-many relations.
- **6NF** splits every column into its own table to version each value over time. The model keeps history where it matters, as append-only tables (prices, deal statuses, the ledger). Splitting every column would make every read a many-way join, for no gain.

Going further would add joins and complexity without removing any real redundancy. BCNF is the usual target for a transactional schema like this one.

### Why `deals` is in 2NF

`deals` has two functional dependencies that do not start from a key:

1. **`lot_id → seller_company_id`.** A lot has one seller, so every deal of the same lot has the same seller. The seller is a copy of `lots.seller_company_id`.
2. **`(quantity, unit_price_minor) → total_minor`.** The total is computed from two other columns.

Both make the table 2NF instead of 3NF. Both are deliberate:

| Copy                | Why it is stored                                                                                                                                                                                                                                                                                                                       | What keeps it correct                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `seller_company_id` | The deal needs the seller in its own row: a foreign key to the seller's wallet, the check `deals_buyer_not_seller` (a `CHECK` cannot read another table), and the index `(seller_company_id, status)` for the seller's deal list without a join. Multi-seller marketplaces usually keep the seller on each order for the same reasons. | The composite foreign key `deals_lot_seller_fkey`: `(lot_id, seller_company_id)` must match a lot and its seller, so the copy can never differ. |
| `total_minor`       | The invoice and the ledger use the total, and it is the amount the buyer agreed to. Order systems store totals too: a Stripe invoice line has its own `amount`, and a Shopify order has `total_price`.                                                                                                                                 | The check `deals_total_matches`: `total_minor = quantity * unit_price_minor`.                                                                   |

The database rejects any row where a copy disagrees with its source, so the copy cannot drift. That gives the integrity of 3NF while keeping the columns the queries and rules need.

`deals.unit_price_minor` is not a copy in this sense. It is the price at the moment of purchase (a snapshot). The lot's price can change later, and the deal must keep the price the buyer paid.

### Copies across tables and rows

Normal forms only look at dependencies inside one row. Some values are also copies of data in other tables or in earlier rows. They do not change any table's normal form, but each one is a deliberate choice with a guard:

| Column                                   | Copy of                                                                        | Why it is stored                                                                            | What keeps it correct                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts.balance_minor`                 | the sum of the account's `ledger_entries.amount_minor`                         | Reading a balance must not sum the whole ledger. Banks keep a running balance the same way. | The service updates it in the same transaction as the entry, with the account row locked; a reconciliation query compares both. Checks keep wallets and escrow at 0 or above, and bank clearing at 0 or below. |
| `ledger_entries.balance_after_minor`     | the account balance after this entry                                           | A statement shows the running balance without a window function over all entries.           | Written by the service from the locked balance.                                                                                                                                                                |
| `ledger_transfers.entry_count`           | the number of the transfer's entries                                           | Closes a committed transfer: a later entry breaks the count.                                | The deferred trigger check `ledger_transfers_balanced` at commit.                                                                                                                                              |
| `lots.unit_price_minor`                  | the newest `lot_price_changes.new_price_minor` of the lot                      | The catalog reads the current price without reading the history.                            | The service writes the lot and the history row in one transaction.                                                                                                                                             |
| `lot_price_changes.old_price_minor`      | the previous row's `new_price_minor`                                           | Each history row reads on its own: "from X to Y".                                           | The service; the check `lot_price_changes_price_changed`; one creation row per lot (`lot_price_changes_creation_key`).                                                                                         |
| `deal_status_changes.from_status`        | the previous row's `to_status`                                                 | Each step reads on its own: "from A to B".                                                  | The service; one creation row per deal (`deal_status_changes_creation_key`).                                                                                                                                   |
| `deals.status`                           | the newest `deal_status_changes.to_status` of the deal                         | Lists and indexes filter by the current status without reading the history.                 | The service writes both in one transaction.                                                                                                                                                                    |
| `invoices.amount_minor`                  | `deals.total_minor`                                                            | The invoice is a document with its own amount.                                              | The service (a cross-table rule, not checked by the database).                                                                                                                                                 |
| `invoices.due_at`, `invoices.expires_at` | the issue time plus `payment_window_days` and `grace_period_days` at that time | A settings change must not move the dates of invoices already issued.                       | Snapshot by design; the check `invoices_dates_ordered`.                                                                                                                                                        |
| `deals.confirmation_due_at`              | the shipping time plus `confirmation_window_days` at that time                 | Same reason: settings changes apply to new deals only.                                      | Snapshot by design; the check `deals_shipped_has_deadline`.                                                                                                                                                    |

## Tables

### companies

A legal entity on the marketplace: a seller, a buyer, or both. Normal form: **BCNF**.

| Column                | Type        | Meaning                                                                                                                      |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid        | Primary key.                                                                                                                 |
| `name`                | text        | The company's name, 1–300 characters.                                                                                        |
| `registration_number` | text        | The official registration number. Unique.                                                                                    |
| `email`               | text        | The company's contact address for billing and notifications, not a login. Stored as typed, unique regardless of letter case. |
| `created_at`          | timestamptz | When the company was added.                                                                                                  |
| `updated_at`          | timestamptz | When the row last changed.                                                                                                   |

### accounts

A place that holds money: a company's wallet, or one of the two platform accounts. A company has zero or one wallet. Rows are never deleted, and only the balance changes. Normal form: **BCNF**.

| Column          | Type        | Meaning                                                                                                                                                                                   |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | uuid        | Primary key. Ledger entries point here.                                                                                                                                                   |
| `type`          | text        | `company_wallet`; `escrow` (money of paid deals, held until payout or refund); or `bank_clearing` (the counterpart of money that entered from the bank, so its balance is 0 or negative). |
| `company_id`    | uuid        | The owner of a wallet. Set only for `company_wallet`, and unique, so one wallet per company. Lots, deals, top-ups and corrections point at this column.                                   |
| `balance_minor` | bigint      | The current balance. Wallets and escrow never go below 0; bank clearing never goes above 0.                                                                                               |
| `created_at`    | timestamptz | When the account was opened. The migration creates the escrow and bank clearing accounts.                                                                                                 |

### lots

Units of one item that a seller offers. Normal form: **BCNF**.

| Column              | Type        | Meaning                                                                        |
| ------------------- | ----------- | ------------------------------------------------------------------------------ |
| `id`                | uuid        | Primary key.                                                                   |
| `seller_company_id` | uuid        | The seller. Points at the seller's wallet.                                     |
| `title`             | text        | The name buyers see, 1–200 characters.                                         |
| `unit_price_minor`  | bigint      | The current price of one unit, above 0. The history is in `lot_price_changes`. |
| `stock_available`   | integer     | Units still for sale, 0 or more. Units of unpaid deals are already subtracted. |
| `status`            | text        | `hidden` (default, not in the catalog) or `published`.                         |
| `created_at`        | timestamptz | When the lot was created. The catalog sorts published lots by it.              |
| `updated_at`        | timestamptz | When the row last changed.                                                     |

### lot_photos

Metadata of one image of a lot. The file itself is in object storage. Deleted together with its lot. Normal form: **BCNF**.

| Column              | Type        | Meaning                                                                                                                 |
| ------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                | uuid        | Primary key.                                                                                                            |
| `lot_id`            | uuid        | The lot the photo belongs to.                                                                                           |
| `storage_key`       | text        | The object's key in object storage. Unique.                                                                             |
| `original_filename` | text        | The file name the seller uploaded, 1–255 characters, shown back to the seller.                                          |
| `content_type`      | text        | `image/jpeg`, `image/png` or `image/webp`.                                                                              |
| `size_bytes`        | integer     | File size in bytes, above 0.                                                                                            |
| `width_px`          | integer     | Image width in pixels, above 0.                                                                                         |
| `height_px`         | integer     | Image height in pixels, above 0.                                                                                        |
| `position`          | integer     | Display order within the lot, from 0. Unique per lot, checked at commit, so photos can be reordered in one transaction. |
| `uploaded_at`       | timestamptz | When the photo was uploaded.                                                                                            |

### lot_price_changes

The price history of a lot: one row when the lot is created, and one row per price change. Append-only; rows go only with their lot. Normal form: **BCNF**.

| Column            | Type        | Meaning                                                               |
| ----------------- | ----------- | --------------------------------------------------------------------- |
| `id`              | bigint      | Primary key, identity. Orders the history.                            |
| `lot_id`          | uuid        | The lot.                                                              |
| `old_price_minor` | bigint      | The price before the change. Empty only in the lot's creation row.    |
| `new_price_minor` | bigint      | The price after the change, above 0 and different from the old price. |
| `actor_type`      | text        | Who changed it: `seller` or `operator`.                               |
| `actor_ref`       | text        | The person who changed it.                                            |
| `changed_at`      | timestamptz | When the price changed.                                               |

### deals

One purchase of units of one lot, from the purchase until payout or refund. Normal form: **2NF**, on purpose (see "Why `deals` is in 2NF").

| Column                | Type        | Meaning                                                                                                                                                           |
| --------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid        | Primary key.                                                                                                                                                      |
| `lot_id`              | uuid        | The lot bought. A lot with deals cannot be deleted.                                                                                                               |
| `buyer_company_id`    | uuid        | The buyer. Points at the buyer's wallet. Never the seller.                                                                                                        |
| `seller_company_id`   | uuid        | The seller, a copy of the lot's seller. Points at the seller's wallet.                                                                                            |
| `quantity`            | integer     | Units bought, 1 or more.                                                                                                                                          |
| `unit_price_minor`    | bigint      | The price of one unit at the moment of purchase. Later price changes do not touch it.                                                                             |
| `total_minor`         | bigint      | `quantity × unit_price_minor`: the amount the buyer pays.                                                                                                         |
| `status`              | text        | Where the deal is: `awaiting_payment`, `paid`, `shipped`, `disputed`, `completed`, `cancelled`, `expired` or `refunded`.                                          |
| `confirmation_due_at` | timestamptz | Set when the seller ships: if the buyer neither confirms nor claims by then, the deal completes automatically. Required in `shipped`, `disputed` and `completed`. |
| `idempotency_key`     | uuid        | Sent by the buyer's client with the purchase. Unique per buyer, so a retried purchase never creates a second deal.                                                |
| `created_at`          | timestamptz | When the purchase was made.                                                                                                                                       |
| `updated_at`          | timestamptz | When the row last changed.                                                                                                                                        |

### deal_status_changes

One step of a deal's lifecycle. Append-only. Normal form: **BCNF**.

| Column        | Type        | Meaning                                                                |
| ------------- | ----------- | ---------------------------------------------------------------------- |
| `id`          | bigint      | Primary key, identity. Orders the steps.                               |
| `deal_id`     | uuid        | The deal.                                                              |
| `from_status` | text        | The status before the step. Empty only in the first row of a deal.     |
| `to_status`   | text        | The status after the step.                                             |
| `actor_type`  | text        | Who made the step: `buyer`, `seller`, `operator` or `system`.          |
| `actor_ref`   | text        | The person who made it. Empty exactly for `system`.                    |
| `reason`      | text        | Why. Required for a move to `disputed` or `refunded`.                  |
| `changed_at`  | timestamptz | When the step happened. The step to `shipped` gives the shipping time. |

### invoices

The buyer's obligation to pay for one deal. One invoice per deal. Normal form: **BCNF**.

| Column         | Type        | Meaning                                                                                         |
| -------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `id`           | uuid        | Primary key.                                                                                    |
| `deal_id`      | uuid        | The deal billed. Unique.                                                                        |
| `number`       | text        | The number people see, `INV-<year>-<at least 6 digits>`, from one database sequence. Unique.    |
| `amount_minor` | bigint      | The amount to pay, equal to the deal's total.                                                   |
| `status`       | text        | `issued`, `paid`, `cancelled` or `expired`.                                                     |
| `issued_at`    | timestamptz | When the invoice was issued.                                                                    |
| `due_at`       | timestamptz | When payment is due.                                                                            |
| `expires_at`   | timestamptz | When an unpaid invoice expires: the due date plus the grace period. After it, the deal expires. |
| `paid_at`      | timestamptz | When it was paid. Set exactly when the status is `paid`.                                        |

### ledger_transfers

One money movement: a top-up, an invoice payment, a payout, a refund or a correction. It points at exactly one source record. Append-only. Normal form: **BCNF**.

| Column          | Type        | Meaning                                                                                                                 |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`            | uuid        | Primary key.                                                                                                            |
| `type`          | text        | `top_up`, `invoice_payment`, `payout`, `refund` or `correction`.                                                        |
| `top_up_id`     | uuid        | The top-up posted, for type `top_up`. One transfer per top-up.                                                          |
| `invoice_id`    | uuid        | The invoice paid, for type `invoice_payment`. An invoice is paid once.                                                  |
| `deal_id`       | uuid        | The deal paid out or refunded, for type `payout` or `refund`. A deal gets one of them, never both.                      |
| `correction_id` | uuid        | The correction posted, for type `correction`. One transfer per correction.                                              |
| `actor_type`    | text        | Who caused it: `buyer`, `seller`, `operator` or `system`.                                                               |
| `actor_ref`     | text        | The person who caused it. Empty exactly for `system`.                                                                   |
| `entry_count`   | smallint    | How many entries the transfer has, 2 or more. At commit, the database checks the entries match this count and sum to 0. |
| `created_at`    | timestamptz | When the money moved.                                                                                                   |

### ledger_entries

One account's side of a transfer. Append-only. Normal form: **BCNF**.

| Column                | Type        | Meaning                                                         |
| --------------------- | ----------- | --------------------------------------------------------------- |
| `id`                  | bigint      | Primary key, identity. Orders an account statement.             |
| `transfer_id`         | uuid        | The transfer this entry belongs to.                             |
| `account_id`          | uuid        | The account the money goes into or out of.                      |
| `amount_minor`        | bigint      | Positive: money into the account. Negative: money out. Never 0. |
| `balance_after_minor` | bigint      | The account's balance right after this entry.                   |
| `created_at`          | timestamptz | When the entry was written.                                     |

### top_ups

The operator's record of one bank notification: money a company sent to the platform's bank account. Normal form: **BCNF**.

| Column           | Type        | Meaning                                                                                                                               |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid        | Primary key.                                                                                                                          |
| `company_id`     | uuid        | The company credited. Points at its wallet.                                                                                           |
| `amount_minor`   | bigint      | The amount received, above 0.                                                                                                         |
| `bank_reference` | text        | The bank's reference of the transfer, in electronic format (upper case, no whitespace). Unique, so one notification is recorded once. |
| `transfer_date`  | date        | The value date from the bank notification.                                                                                            |
| `invoice_id`     | uuid        | The invoice named in the payment reference, if any. The service can then pay that invoice from the wallet.                            |
| `operator_ref`   | text        | The operator who recorded it.                                                                                                         |
| `recorded_at`    | timestamptz | When it was recorded.                                                                                                                 |

### corrections

The operator's fix of a wrong company balance. Normal form: **BCNF**.

| Column            | Type        | Meaning                                                                                 |
| ----------------- | ----------- | --------------------------------------------------------------------------------------- |
| `id`              | uuid        | Primary key.                                                                            |
| `company_id`      | uuid        | The company whose balance is fixed. Points at its wallet.                               |
| `amount_minor`    | bigint      | Positive adds to the wallet, negative takes from it. Never 0.                           |
| `reason`          | text        | Why the correction is needed, 1–1000 characters.                                        |
| `top_up_id`       | uuid        | The top-up being fixed, if any.                                                         |
| `operator_ref`    | text        | The operator who made it.                                                               |
| `idempotency_key` | uuid        | Sent by the operator's client. Unique, so a retried submission never moves money twice. |
| `created_at`      | timestamptz | When it was made.                                                                       |

### platform_settings

The operator's limits and time windows. Exactly one row. Deals and invoices copy the values they need when they are created, so a change applies to new deals only. Normal form: **BCNF**.

| Column                     | Type        | Meaning                                                                                               |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `id`                       | smallint    | Always 1.                                                                                             |
| `payment_window_days`      | integer     | Days from issue to the invoice's due date. Default 5.                                                 |
| `grace_period_days`        | integer     | Extra days after the due date before an unpaid invoice expires. Default 1.                            |
| `max_unpaid_deals`         | integer     | How many deals a buyer may have in `awaiting_payment` at once. Default 3.                             |
| `expiry_limit`             | integer     | How many expired deals in the look-back period make a buyer pay at purchase (prepay only). Default 2. |
| `expiry_lookback_days`     | integer     | The look-back period for `expiry_limit`, in days. Default 30.                                         |
| `confirmation_window_days` | integer     | Days the buyer has after shipping to confirm or claim. Default 14.                                    |
| `updated_by_ref`           | text        | The operator who last changed the settings. Empty until the first change.                             |
| `updated_at`               | timestamptz | When the settings last changed.                                                                       |
