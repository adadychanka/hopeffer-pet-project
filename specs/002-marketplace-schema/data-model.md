# Data Model: Marketplace Schema

The tables, columns and rules are those of [feature 001's data-model.md](../001-marketplace-data-model/data-model.md), with the changes below (spec Clarifications, FR-029). The implementation updates that file first, so it stays the single source of truth. This file describes what changes against it, how each table maps to an entity, and the naming rules. The complete list of named rules is in [contracts/schema-rules.md](./contracts/schema-rules.md).

## Changes against feature 001

| Table                 | Change                                                                                                                                                                                                                        | Spec                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `companies`           | New column `email text NOT NULL`: at most 254 characters, basic shape check, stored as typed, unique on `lower(email)`                                                                                                        | Q1, Q2, FR-005          |
| `accounts`            | A company has zero or one wallet (unchanged columns). Rows are never deleted, and `type` and `company_id` never change. `company_id` → `companies` is `ON DELETE RESTRICT`.                                                   | Q3, FR-006              |
| `lots`                | `seller_company_id` references `accounts (company_id)` instead of `companies (id)`                                                                                                                                            | Q3, FR-006a             |
| `deals`               | `buyer_company_id` and `seller_company_id` reference `accounts (company_id)`. The composite key to `lots (id, seller_company_id)` stays. New column `idempotency_key uuid NOT NULL`, unique together with `buyer_company_id`. | Q3, Q4, FR-006a, FR-009 |
| `deal_status_changes` | At most one row per deal has `from_status` null (partial unique index). Data-model.md states the rule in words only.                                                                                                          | FR-010                  |
| `top_ups`             | `company_id` references `accounts (company_id)`. New check: `bank_reference` equals its trimmed, upper-case form.                                                                                                             | Q3, FR-015              |
| `corrections`         | `company_id` references `accounts (company_id)`. New column `idempotency_key uuid NOT NULL UNIQUE`.                                                                                                                           | Q3, Q4, FR-016          |
| `ledger_entries`      | New index `(transfer_id)` for the zero-sum trigger                                                                                                                                                                            | research R7             |
| `lot_price_changes`   | New table (below)                                                                                                                                                                                                             | Q5, FR-010a             |

ERD cardinality changes:

- `companies |o--o| accounts` (was `|o--||`)
- new edges `accounts ||--o{ lots`, `accounts ||--o{ deals` (buyer and seller), `accounts ||--o{ top_ups`, `accounts ||--o{ corrections`, which replace the matching edges from `companies`
- new `lots ||--|{ lot_price_changes : "price history"`

### lot_price_changes

| Column            | Type        | Rules                                                 |
| ----------------- | ----------- | ----------------------------------------------------- |
| `id`              | bigint      | PK, identity (`GENERATED ALWAYS`); orders the history |
| `lot_id`          | uuid        | not null, FK `lots` `ON DELETE CASCADE`               |
| `old_price_minor` | bigint      | null only in the lot's creation row; otherwise `> 0`  |
| `new_price_minor` | bigint      | not null, `> 0`, distinct from `old_price_minor`      |
| `actor_type`      | text        | `seller`, `operator`                                  |
| `actor_ref`       | text        | not null                                              |
| `changed_at`      | timestamptz | not null, default `now()`                             |

- `UNIQUE (lot_id) WHERE old_price_minor IS NULL`: one creation row per lot.
- Index `(lot_id, id)` for a lot's history.
- Never updated. Deleted only by the cascade when its lot (without deals) is deleted.
- The service writes the creation row with the lot, and one row per price change in the same transaction. `lots.unit_price_minor` equals the newest `new_price_minor`; that cross-table rule is the service's.

## Entity mapping

| Table                 | Entity             | File                                                | Module                   |
| --------------------- | ------------------ | --------------------------------------------------- | ------------------------ |
| `companies`           | `Company`          | `src/companies/company.entity.ts`                   | `CompaniesModule`        |
| `lots`                | `Lot`              | `src/catalog/lot.entity.ts`                         | `CatalogModule`          |
| `lot_photos`          | `LotPhoto`         | `src/catalog/lot-photo.entity.ts`                   | `CatalogModule`          |
| `lot_price_changes`   | `LotPriceChange`   | `src/catalog/lot-price-change.entity.ts`            | `CatalogModule`          |
| `deals`               | `Deal`             | `src/deals/deal.entity.ts`                          | `DealsModule`            |
| `deal_status_changes` | `DealStatusChange` | `src/deals/deal-status-change.entity.ts`            | `DealsModule`            |
| `invoices`            | `Invoice`          | `src/deals/invoice.entity.ts`                       | `DealsModule`            |
| `accounts`            | `Account`          | `src/ledger/account.entity.ts`                      | `LedgerModule`           |
| `ledger_transfers`    | `LedgerTransfer`   | `src/ledger/ledger-transfer.entity.ts`              | `LedgerModule`           |
| `ledger_entries`      | `LedgerEntry`      | `src/ledger/ledger-entry.entity.ts`                 | `LedgerModule`           |
| `top_ups`             | `TopUp`            | `src/ledger/top-up.entity.ts`                       | `LedgerModule`           |
| `corrections`         | `Correction`       | `src/ledger/correction.entity.ts`                   | `LedgerModule`           |
| `platform_settings`   | `PlatformSettings` | `src/platform-settings/platform-settings.entity.ts` | `PlatformSettingsModule` |

Properties are camelCase and columns snake_case, set with `name` on each `@Column` (no global naming strategy, so a reader sees the column name next to the property).

## Column type mapping

| PostgreSQL                 | Decorator                                                                                                         | TypeScript                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `uuid` primary key         | `@PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: '<table>_pkey' })` (default `gen_random_uuid()`, R3) | `string`                                                    |
| `uuid` reference           | `@Column({ type: 'uuid' })` + `@ForeignKey` (R2)                                                                  | `string` (or `string \| null`)                              |
| `bigint` identity key      | `@PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS', primaryKeyConstraintName })`  | `string` (no transformer allowed; spike, R13)               |
| `bigint` money (`*_minor`) | `@Column({ type: 'bigint', transformer: safeBigint })`                                                            | `number` (R6)                                               |
| `integer`, `smallint`      | `@Column({ type: 'integer' })`                                                                                    | `number`                                                    |
| `text` with a value list   | `@Column({ type: 'text' })` + `@Check` built from an `as const` array                                             | union type, for example `AccountType`                       |
| `text`                     | `@Column({ type: 'text' })`                                                                                       | `string`                                                    |
| `date`                     | `@Column({ type: 'date' })`                                                                                       | `string` (`YYYY-MM-DD`; TypeORM returns `date` as a string) |
| `timestamptz`              | `@Column({ type: 'timestamptz' })`, `@CreateDateColumn`, `@UpdateDateColumn`                                      | `Date`                                                      |

Every column sets its type explicitly, so the mapping does not depend on emitted decorator metadata.

## Naming rules

| Object                            | Pattern                                                               | Example                                                                 |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Primary key                       | `<table>_pkey`                                                        | `deals_pkey`                                                            |
| Value list or range check         | `<table>_<column>_check`                                              | `accounts_type_check`                                                   |
| Multi-column or semantic check    | `<table>_<rule>`                                                      | `deals_buyer_not_seller`                                                |
| Unique constraint or unique index | `<table>_<columns>_key`, or `<table>_<rule>_key` for partial ones     | `invoices_deal_id_key`, `ledger_transfers_invoice_payment_key`          |
| Foreign key                       | `<table>_<columns>_fkey`, or `<table>_<rule>_fkey` for composite ones | `deals_lot_seller_fkey`                                                 |
| Plain index                       | `<table>_<columns>_idx`                                               | `deals_buyer_company_id_status_idx`                                     |
| Trigger                           | `<table>_<rule>`                                                      | `ledger_entries_balanced`                                               |
| Function                          | verb first                                                            | `reject_change()`, `check_transfer_balanced()`, `next_invoice_number()` |

## Seed rows

| Migration                    | Rows                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `CreateCompaniesAndAccounts` | `accounts`: one `escrow`, one `bank_clearing`, both with `company_id` null and balance 0     |
| `CreatePlatformSettings`     | `platform_settings`: `id = 1` with the defaults 5, 1, 3, 2, 30, 14 and `updated_by_ref` null |

Their `down()` drops the triggers, the functions and the tables. Dropping a table removes its seed rows, and `DROP TABLE` does not fire the account guard, which watches only `UPDATE` and `DELETE`.
