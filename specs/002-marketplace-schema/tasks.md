---
description: 'Task list for the marketplace schema feature'
---

# Tasks: Marketplace Schema

**Input**: Design documents from `specs/002-marketplace-schema/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/schema-rules.md](./contracts/schema-rules.md), [quickstart.md](./quickstart.md)

**Tests**: Requested by the spec (FR-024, FR-025, FR-026, SC-001). Every rule in `contracts/schema-rules.md` gets a test that breaks it and a test that passes it.

**Organization**: Tasks are grouped by user story. US1 builds every entity and migration, because its acceptance test is "all 13 tables exist". US2 and US3 then prove the rules that US1 declared, US4 proves the code mapping, US5 adds the drift check and US6 the documentation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to (US1–US6)

## Conventions for every task

- **Column and rule definitions:** they come from `specs/001-marketplace-data-model/data-model.md` (the "Tables" section), which T007 updates first to the changes listed in `specs/002-marketplace-schema/data-model.md`. Every rule name and its exact SQL definition come from `contracts/schema-rules.md`. Use the names exactly as written there (research R5).
- **Entity files:** every column sets `name` (snake_case) and `type` explicitly. Every reference column is a plain `@Column({ type: 'uuid', name: ... })` with a named `@ForeignKey` (R2), never `@ManyToOne`. Value lists are `export const X = [...] as const` arrays; the `@Check` text is built from them, and the TypeScript union comes from `(typeof X)[number]`. Money `bigint` columns use `transformer: safeBigint` (R6). Identity keys are `string` (R13 spike result). Every primary key sets `primaryKeyConstraintName: '<table>_pkey'`, because TypeORM otherwise generates a hash name. Imports use the `.js` extension.
- **Migrations:**
  1. Run `pnpm run migration:run` so the local database is at the newest migration.
  2. Add the area's entities.
  3. Run `pnpm run migration:generate src/database/migrations/<Name>`.
  4. Add the hand-written SQL named in the task.
  5. Run `pnpm run format`, then `pnpm run migration:run`, then `pnpm run migration:check` (expected: no changes).
- **Mistakes found later:** if a later task finds a mistake in a migration of this feature, fix that migration in place (it is not merged or deployed). Then run `migration:revert` back to it, `migration:run` and `migration:check`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared database helpers and options that every entity and test uses, and feature 001's design text updated first, so it is the single source for the entity tasks (spec Scope).

- [x] T001 Start the local services with `pnpm run docker:up`, make sure `.env` exists (copy `.env.example`), and confirm `pnpm run migration:run` reports no pending migrations on branch `002-marketplace-schema`
- [x] T002 [P] Create `src/database/typeorm-options.ts` exporting `buildTypeOrmOptions(url: string)`, which returns `{ type: 'postgres', url, uuidExtension: 'pgcrypto', installExtensions: false }` typed as TypeORM's `PostgresDataSourceOptions`, with a comment on why (R3: `gen_random_uuid()` is built into PostgreSQL 13+, and every `DataSource` must agree or the drift check compares different defaults). Write `src/database/typeorm-options.spec.ts` asserting the returned object.
- [x] T003 [P] Create `src/database/safe-bigint.ts` with `safeBigint: ValueTransformer` and `parseSafeBigint(value: string | null): number | null` (R6):
  - `to()` passes `null`/`undefined` through, returns a safe integer unchanged, and throws `RangeError` for anything else (non-integer, above `Number.MAX_SAFE_INTEGER`, below `Number.MIN_SAFE_INTEGER`).
  - `from()` passes `null` through, turns a string into a number, and throws `RangeError` unless the result is a safe integer.
  - `parseSafeBigint` follows the same rules for raw query results such as `SUM(...)`, which `pg` returns as a string.
  - Write `src/database/safe-bigint.spec.ts` first, covering: `null`/`undefined`; `0`, negative and positive values; exactly `9007199254740991` and `-9007199254740991`; `'9007199254740992'` throws; `1.5` throws; `parseSafeBigint('123')` returns `123`; `parseSafeBigint(null)` returns `null`.
- [x] T004 Start every `DataSource` from `buildTypeOrmOptions(url)`: the `useFactory` in `src/database/database.module.ts` (spread it, then add `extra`, `logger`, `maxQueryExecutionTime` and `autoLoadEntities`), the CLI `DataSource` in `src/database/data-source.ts` (add the entity and migration globs), and the `DataSource` in `test/setup/global-setup.ts` (add `migrations`)
- [x] T005 [P] Add the script `"migration:check": "pnpm run build && typeorm migration:generate src/database/migrations/SchemaDrift --check -d dist/database/data-source.js"` to `package.json` next to the other `migration:*` scripts, and run `pnpm exec prettier --write package.json`
- [x] T006 [P] Move `loadMigrations()` from `test/setup/global-setup.ts` into a new `test/setup/migrations.ts` (export it, keep its comment about Vite compiling the `.ts` migrations), and import it in `global-setup.ts`. The round-trip test (T011) reuses it.

- [x] T007 [P] Update `specs/001-marketplace-data-model/data-model.md` to the deltas in `specs/002-marketplace-schema/data-model.md`:
  - **Mermaid `erDiagram`:**
    - `companies |o--o| accounts`
    - edges from `accounts` to `lots`, `deals` (buyer and seller), `top_ups` and `corrections`, in place of the edges from `companies`
    - `lots ||--|{ lot_price_changes : "price history"`
    - new columns `email`, `idempotency_key` (deals, corrections)
    - the `lot_price_changes` block
  - **Cardinality note:** update it.
  - **Tables sections:** `companies` gets `email`. `accounts` gets "zero or one wallet", the delete and update guard, and `ON DELETE RESTRICT`. `lots`, `deals`, `top_ups` and `corrections` get the wallet foreign keys. `deal_status_changes` gets the partial unique. `ledger_entries` gets the `(transfer_id)` index. Add a new `### lot_price_changes` section.
  - **Invariants table:** "One wallet per company" becomes "Zero or one wallet per company; a wallet before any lot, deal, top-up or correction", enforced by `UNIQUE (company_id)` and the wallet foreign keys. Add rows for "Deal and correction submitted once" (`idempotency_key` unique rules) and "Price history never changes" (trigger).
  - **Order:** keep the order of sections.
- [x] T008 [P] In `specs/001-marketplace-data-model/spec.md`, change only FR-002 to: "The model MUST give a company zero or one wallet. A wallet starts with balance 0. A company needs its wallet before it publishes a lot, buys, or receives a top-up or correction (changed by feature 002)." Add the new entity "Lot price change" to Key Entities.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Prove the risky TypeORM mappings before 13 entities depend on them (R13), and build the test helpers every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T009 Spike (R13). Create two throwaway entities, `src/spike/spike-parent.entity.ts` and `src/spike/spike-child.entity.ts`, that use every risky mapping:
  - a parent with `UNIQUE (id, owner_id)` and a nullable unique `owner_id`
  - a child with a class-level composite `@ForeignKey(() => SpikeParent, ['parentId', 'ownerId'], ['id', 'ownerId'], { name: 'spike_children_parent_owner_fkey', onDelete: 'RESTRICT' })` and a second `@ForeignKey(() => SpikeParent, 'ownerId', { name: 'spike_children_owner_id_fkey' })` on the same `ownerId` column
  - an `@Index('spike_parents_name_lower_key', { synchronize: false })` created by hand as `CREATE UNIQUE INDEX ... (lower(name))`
  - a `@Unique(..., { deferrable: 'INITIALLY DEFERRED' })`
  - a column with `default: () => 'spike_next()'` backed by a hand-written SQL function created at the start of `up()`
  - an identity key `@PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS', transformer: safeBigint })`

  Generate the migration, add the hand SQL, run it, then run `pnpm run migration:check`. Pass condition: "No changes in database schema were found". If a mapping fails, find a working form or fallback (R13) and record it as "Spike result" at the end of R13 in `specs/002-marketplace-schema/research.md`, plus any change for the later tasks. Then run `pnpm run migration:revert` and delete `src/spike/` and the spike migration file.

- [x] T010 Create `test/schema/helpers.ts` (R14):
  - `entityClasses()`: loads `import.meta.glob('../../src/**/*.entity.ts', { eager: true })` (add `/// <reference types="vite/client" />`) and returns every exported value that is a class decorated as an entity (`getMetadataArgsStorage().tables` contains it).
  - `openTestDataSource()`: `new DataSource({ ...buildTypeOrmOptions(inject('databaseUrl')), entities: entityClasses() })`, initialized. Schema tests are database tests and use this instead of booting `AppModule` (constitution 1.1.0, Principle II).
  - `expectRule(promise, name)`: asserts a `QueryFailedError` whose `driverError.constraint === name`.
  - `expectNotNull(promise, column)`: asserts `driverError.code === '23502'` and `driverError.column === column`.
  - `unique(prefix)`: a short random suffix for registration numbers, emails, bank references and storage keys.
  - Raw-SQL fixtures that return ids:
    - `createCompany({ wallet = true })`
    - `createLot(sellerId, overrides)`
    - `createDeal({ buyerId, sellerId, lotId, ...overrides })`, which writes `quantity 1`, the lot's price, a matching `total_minor`, status `awaiting_payment` and a random `idempotency_key`
    - `createInvoice(dealId, overrides)`
    - `createTopUp(companyId, overrides)`
    - `createCorrection(companyId, overrides)`
    - `writeTransfer(queryRunner, { type, source, actor, entries: [{ accountId, amountMinor }] })`, which inserts a transfer and its entries without committing
    - `platformAccountId(type)`

  Fixtures that need not-yet-built tables compile now and run once US1 is done.

**Checkpoint**: Mappings proven, helpers ready.

---

## Phase 3: User Story 1 - A fresh database gets the full schema (Priority: P1) 🎯 MVP

**Goal**: The five migrations create all 13 tables with their rules, triggers and seed rows, and they revert cleanly.

**Independent Test**: On a throwaway database, apply all migrations, check the tables and seed rows, revert them all, apply them again, and compare the catalog snapshots (`test/schema/migrations.e2e-spec.ts`).

### Tests for User Story 1

- [x] T011 [US1] Write `test/schema/migrations.e2e-spec.ts` (it fails until T032):
  1. With an admin connection from `inject('databaseUrl')`, run `CREATE DATABASE schema_roundtrip_<random>`, and open a `DataSource` on it with `...buildTypeOrmOptions(<throwaway database URL>)` and `migrations: loadMigrations()` (from `test/setup/migrations.ts`).
  2. Run `runMigrations()`. Assert:
     - the 13 tables exist
     - `accounts` holds exactly one `escrow` and one `bank_clearing` row, each with `company_id IS NULL` and `balance_minor = 0`
     - `platform_settings` holds one row `(1, 5, 1, 3, 2, 30, 14)` with `updated_by_ref IS NULL`
  3. Take a catalog snapshot of schema `public`:
     - tables
     - columns with type, nullability and default
     - constraints with `pg_get_constraintdef`
     - indexes with `pg_get_indexdef`
     - non-internal triggers with `pg_get_triggerdef`
     - functions with `pg_get_functiondef`
     - sequences
  4. Call `undoLastMigration()` until the `migrations` table is empty. Assert that only the `migrations` table and its id sequence remain, with no functions and no triggers.
  5. Run `runMigrations()` again. Assert the snapshot equals the first one.
  6. Invoice number edge case: on this database (not the shared one), run `SELECT setval('invoice_number_seq', 999999)`, then `SELECT next_invoice_number()`, and assert the result matches `^INV-[0-9]{4}-1000000$` (7 digits, not cut). No rows are needed; T041 covers the column default.
  7. Destroy the `DataSource` and `DROP DATABASE` in `afterAll`.

### Implementation for User Story 1

- [x] T012 [P] [US1] Create `src/database/actor-types.ts` exporting `ACTOR_TYPES = ['buyer', 'seller', 'operator', 'system'] as const` and `type ActorType`, shared by `deal_status_changes` and `ledger_transfers`
- [x] T013 [P] [US1] Create the `Company` entity in `src/companies/company.entity.ts`, table `companies`:
  - Columns:
    - `id uuid` PK (`@PrimaryGeneratedColumn('uuid')`)
    - `name text` not null
    - `registration_number text` not null
    - `email text` not null
    - `created_at timestamptz` (`@CreateDateColumn`)
    - `updated_at timestamptz` (`@UpdateDateColumn`)
  - Rules: `companies_name_length` ("not null, 1–300 chars"), `companies_registration_number_key`, `companies_email_format` ("at most 254 characters, one `@` with text on both sides and no spaces"), and `@Index('companies_email_lower_key', { synchronize: false })` for the hand-made `lower(email)` index.
- [x] T014 [P] [US1] Create the `Account` entity in `src/ledger/account.entity.ts`, table `accounts`:
  - `ACCOUNT_TYPES = ['company_wallet', 'escrow', 'bank_clearing']`
  - Columns:
    - `id uuid` PK
    - `type text`
    - `company_id uuid` nullable, with `@ForeignKey(() => Company, 'id', { name: 'accounts_company_id_fkey', onDelete: 'RESTRICT' })`
    - `balance_minor bigint` not null, default `0`, `safeBigint`
    - `created_at timestamptz`
  - Rules: `accounts_type_check`, `accounts_company_matches_type`, the plain `@Unique('accounts_company_id_key', ['companyId'])` (it must be a full unique constraint, because it is a foreign key target), `@Index('accounts_platform_type_key', ['type'], { unique: true, where: "type <> 'company_wallet'" })`, `accounts_balance_not_negative`, `accounts_bank_clearing_not_positive`.
- [x] T015 [US1] Create `src/companies/companies.module.ts` (`TypeOrmModule.forFeature([Company])`, exports `TypeOrmModule`) and `src/ledger/ledger.module.ts` (starts with `[Account]`, exports `TypeOrmModule`), and import both in `src/app.module.ts`
- [x] T016 [US1] Generate `src/database/migrations/<ts>-CreateCompaniesAndAccounts.ts`. Then add by hand, at the end of `up()`:
  - `CREATE UNIQUE INDEX "companies_email_lower_key" ON "companies" (lower("email"))`
  - function `reject_change()`: `RAISE EXCEPTION '% rejects %', TG_NAME, TG_OP USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME`; returns `NULL`
  - function `reject_account_change()`: raises the same way on `DELETE`, and on `UPDATE` when `NEW.type IS DISTINCT FROM OLD.type OR NEW.company_id IS DISTINCT FROM OLD.company_id`; otherwise returns `NEW`
  - trigger `accounts_identity_immutable` `BEFORE UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION reject_account_change()`
  - seed `INSERT INTO accounts (type) VALUES ('escrow'), ('bank_clearing')`

  At the start of `down()`, drop the trigger, both functions and the index. Then follow the migration steps in Conventions.

- [x] T017 [P] [US1] Create the `PlatformSettings` entity in `src/platform-settings/platform-settings.entity.ts`, table `platform_settings`:
  - Columns:
    - `id smallint` PK, default `1` (`@PrimaryColumn({ type: 'smallint', default: 1 })`)
    - `payment_window_days integer` default `5`
    - `grace_period_days integer` default `1`
    - `max_unpaid_deals integer` default `3`
    - `expiry_limit integer` default `2`
    - `expiry_lookback_days integer` default `30`
    - `confirmation_window_days integer` default `14`
    - `updated_by_ref text` nullable ("null until the first edit")
    - `updated_at timestamptz` (`@UpdateDateColumn`)
  - Rules: `platform_settings_single_row` (`id = 1`), and the six `platform_settings_<column>_check` rules (`>= 1`, except `grace_period_days >= 0`).
- [x] T018 [US1] Create `src/platform-settings/platform-settings.module.ts`, import it in `src/app.module.ts`, and generate `src/database/migrations/<ts>-CreatePlatformSettings.ts` with the seed `INSERT INTO platform_settings DEFAULT VALUES` at the end of `up()`
- [x] T019 [P] [US1] Create the `Lot` entity in `src/catalog/lot.entity.ts`, table `lots`:
  - `LOT_STATUSES = ['hidden', 'published']`
  - Columns:
    - `id uuid` PK
    - `seller_company_id uuid` not null, with `@ForeignKey(() => Account, 'companyId', { name: 'lots_seller_company_id_fkey' })`
    - `title text` ("not null, 1–200 chars")
    - `unit_price_minor bigint` ("not null, `> 0`"), `safeBigint`
    - `stock_available integer` ("not null, `>= 0`")
    - `status text`, default `'hidden'`
    - `created_at`, `updated_at`
  - Rules: `lots_title_length`, `lots_unit_price_positive`, `lots_stock_not_negative`, `lots_status_check`, `@Unique('lots_id_seller_company_id_key', ['id', 'sellerCompanyId'])`, `lots_seller_company_id_idx`, and `@Index('lots_published_created_at_idx', ['createdAt'], { where: "status = 'published'" })`.
- [x] T020 [P] [US1] Create the `LotPhoto` entity in `src/catalog/lot-photo.entity.ts`, table `lot_photos`:
  - `LOT_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']`
  - Columns:
    - `id uuid` PK
    - `lot_id uuid`, with `@ForeignKey(() => Lot, 'id', { name: 'lot_photos_lot_id_fkey', onDelete: 'CASCADE' })`
    - `storage_key text` ("not null, `UNIQUE`; the object key in the S3 bucket")
    - `original_filename text` ("not null, 1–255 chars")
    - `content_type text`
    - `size_bytes integer`, `width_px integer`, `height_px integer` (each "not null, `> 0`")
    - `position integer` ("not null, `>= 0`")
    - `uploaded_at timestamptz` not null, default `now()`
  - Rules: every rule of the `lot_photos` section of the contract, including `@Unique('lot_photos_lot_id_position_key', ['lotId', 'position'], { deferrable: 'INITIALLY DEFERRED' })`.
- [x] T021 [P] [US1] Create the `LotPriceChange` entity in `src/catalog/lot-price-change.entity.ts`, table `lot_price_changes`:
  - `PRICE_ACTOR_TYPES = ['seller', 'operator']`
  - Columns:
    - `id bigint` identity (`generatedIdentity: 'ALWAYS'`), typed `string`
    - `lot_id uuid`, with `@ForeignKey(() => Lot, 'id', { name: 'lot_price_changes_lot_id_fkey', onDelete: 'CASCADE' })`
    - `old_price_minor bigint` nullable ("null only in the lot's creation row; otherwise `> 0`")
    - `new_price_minor bigint` ("not null, `> 0`, distinct from `old_price_minor`")
    - `actor_type text`
    - `actor_ref text` not null
    - `changed_at timestamptz` not null, default `now()`
  - Rules: `lot_price_changes_old_price_positive`, `lot_price_changes_new_price_positive`, `lot_price_changes_price_changed`, `lot_price_changes_actor_type_check`, `@Index('lot_price_changes_creation_key', ['lotId'], { unique: true, where: '"old_price_minor" IS NULL' })`, `lot_price_changes_lot_id_id_idx`.
- [x] T022 [US1] Create `src/catalog/catalog.module.ts` (`[Lot, LotPhoto, LotPriceChange]`), import it in `src/app.module.ts`, and generate `src/database/migrations/<ts>-CreateCatalog.ts`. Add by hand at the end of `up()`:
  - function `reject_price_change_edit()`: raises like `reject_change()` on `UPDATE`; on `DELETE`, returns `OLD` when `pg_trigger_depth() > 1` (the lot's cascade) and raises otherwise (R7)
  - trigger `lot_price_changes_append_only` `BEFORE UPDATE OR DELETE ON lot_price_changes FOR EACH ROW`

  At the start of `down()`, drop both.

- [x] T023 [P] [US1] Create the `Deal` entity in `src/deals/deal.entity.ts`, table `deals`:
  - `DEAL_STATUSES = ['awaiting_payment', 'paid', 'shipped', 'disputed', 'completed', 'cancelled', 'expired', 'refunded']`
  - Columns:
    - `id uuid` PK
    - `lot_id uuid` not null
    - `buyer_company_id uuid` not null
    - `seller_company_id uuid` not null
    - `quantity integer` ("not null, `>= 1`")
    - `unit_price_minor bigint` ("not null, `> 0`; copied from the lot at purchase")
    - `total_minor bigint` ("`CHECK (total_minor = quantity * unit_price_minor)`")
    - `status text`
    - `confirmation_due_at timestamptz` nullable ("null until shipped")
    - `idempotency_key uuid` not null
    - `created_at`, `updated_at`
  - Foreign keys:
    - `@ForeignKey(() => Account, 'companyId', { name: 'deals_buyer_company_id_fkey' })`
    - `@ForeignKey(() => Account, 'companyId', { name: 'deals_seller_company_id_fkey' })`
    - class-level `@ForeignKey(() => Lot, ['lotId', 'sellerCompanyId'], ['id', 'sellerCompanyId'], { name: 'deals_lot_seller_fkey', onDelete: 'RESTRICT' })`
  - Rules: every rule of the `deals` section of the contract, including `@Unique('deals_buyer_idempotency_key_key', ['buyerCompanyId', 'idempotencyKey'])` and the four indexes.
- [x] T024 [P] [US1] Create the `DealStatusChange` entity in `src/deals/deal-status-change.entity.ts`, table `deal_status_changes`:
  - Columns:
    - `id bigint` identity (`generatedIdentity: 'ALWAYS'`), typed `string`
    - `deal_id uuid`, with `@ForeignKey(() => Deal, 'id', { name: 'deal_status_changes_deal_id_fkey' })`
    - `from_status text` nullable ("null only for the first row of a deal")
    - `to_status text`
    - `actor_type text` (`ACTOR_TYPES`)
    - `actor_ref text` nullable ("null exactly when `actor_type = 'system'`")
    - `reason text` nullable ("required when `to_status` is `disputed` or `refunded`")
    - `changed_at timestamptz` not null, default `now()`
  - Rules: every rule of the `deal_status_changes` section of the contract, including `@Index('deal_status_changes_creation_key', ['dealId'], { unique: true, where: '"from_status" IS NULL' })`.
- [x] T025 [P] [US1] Create the `Invoice` entity in `src/deals/invoice.entity.ts`, table `invoices`:
  - `INVOICE_STATUSES = ['issued', 'paid', 'cancelled', 'expired']`
  - Columns:
    - `id uuid` PK
    - `deal_id uuid`, with `@ForeignKey(() => Deal, 'id', { name: 'invoices_deal_id_fkey' })`
    - `number text` not null, `default: () => 'next_invoice_number()'`
    - `amount_minor bigint` ("not null, `> 0`")
    - `status text`
    - `issued_at`, `due_at`, `expires_at timestamptz` not null
    - `paid_at timestamptz` nullable ("not null exactly when `status = 'paid'`")
  - Rules: every rule of the `invoices` section of the contract.
- [x] T026 [US1] Create `src/deals/deals.module.ts` (`[Deal, DealStatusChange, Invoice]`), import it in `src/app.module.ts`, and generate `src/database/migrations/<ts>-CreateDeals.ts`.
  - At the **start** of `up()`, because the `invoices` default needs the function before the table exists: `CREATE SEQUENCE invoice_number_seq` and function `next_invoice_number()` (R8). It calls `nextval` once into a variable and returns `'INV-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-' || lpad(n::text, greatest(6, length(n::text)), '0')`.
  - At the **end** of `up()`: trigger `deal_status_changes_append_only` `BEFORE UPDATE OR DELETE ON deal_status_changes FOR EACH ROW EXECUTE FUNCTION reject_change()`.
  - In `down()`, the reverse order: drop the trigger first, the generated drops next, and the function and sequence last.
- [x] T027 [P] [US1] Create the `TopUp` entity in `src/ledger/top-up.entity.ts`, table `top_ups`:
  - Columns:
    - `id uuid` PK
    - `company_id uuid`, with `@ForeignKey(() => Account, 'companyId', { name: 'top_ups_company_id_fkey' })`
    - `amount_minor bigint` ("not null, `> 0`")
    - `bank_reference text` ("not null, `UNIQUE`; trimmed and upper case")
    - `transfer_date date` not null
    - `invoice_id uuid` nullable, with `@ForeignKey(() => Invoice, 'id', { name: 'top_ups_invoice_id_fkey' })`
    - `operator_ref text` not null
    - `recorded_at timestamptz` not null, default `now()`
  - Rules: every rule of the `top_ups` section of the contract.
- [x] T028 [P] [US1] Create the `Correction` entity in `src/ledger/correction.entity.ts`, table `corrections`:
  - Columns:
    - `id uuid` PK
    - `company_id uuid`, with `@ForeignKey(() => Account, 'companyId', { name: 'corrections_company_id_fkey' })`
    - `amount_minor bigint` ("not null, `<> 0`")
    - `reason text` ("not null, 1–1000 chars")
    - `top_up_id uuid` nullable, with `@ForeignKey(() => TopUp, 'id', { name: 'corrections_top_up_id_fkey' })`
    - `operator_ref text` not null
    - `idempotency_key uuid` not null
    - `created_at`
  - Rules: every rule of the `corrections` section of the contract.
- [x] T029 [P] [US1] Create the `LedgerTransfer` entity in `src/ledger/ledger-transfer.entity.ts`, table `ledger_transfers`:
  - `TRANSFER_TYPES = ['top_up', 'invoice_payment', 'payout', 'refund', 'correction']`
  - Columns:
    - `id uuid` PK
    - `type text`
    - nullable `top_up_id`, `invoice_id`, `deal_id`, `correction_id` (each `uuid` with its named `@ForeignKey`)
    - `actor_type text` (`ACTOR_TYPES`)
    - `actor_ref text` nullable
    - `created_at`
  - Rules: every rule of the `ledger_transfers` section of the contract that is a check, unique, unique index or foreign key.
- [x] T030 [P] [US1] Create the `LedgerEntry` entity in `src/ledger/ledger-entry.entity.ts`, table `ledger_entries`:
  - Columns:
    - `id bigint` identity (`generatedIdentity: 'ALWAYS'`), typed `string`
    - `transfer_id uuid`, with `@ForeignKey(() => LedgerTransfer, 'id', { name: 'ledger_entries_transfer_id_fkey' })`
    - `account_id uuid`, with `@ForeignKey(() => Account, 'id', { name: 'ledger_entries_account_id_fkey' })`
    - `amount_minor bigint` ("not null, `<> 0`; positive into the account, negative out of it")
    - `balance_after_minor bigint` not null
    - `created_at`
  - Rules: `ledger_entries_amount_not_zero`, `ledger_entries_transfer_id_idx`, `ledger_entries_account_id_id_idx`.
- [x] T031 [US1] Add `TopUp`, `Correction`, `LedgerTransfer` and `LedgerEntry` to `src/ledger/ledger.module.ts`, and generate `src/database/migrations/<ts>-CreateLedger.ts`. Add by hand at the end of `up()`:
  - function `check_transfer_balanced()`:
    - the transfer id is `NEW.transfer_id` when `TG_TABLE_NAME = 'ledger_entries'`, else `NEW.id`
    - it counts and sums that transfer's entries
    - it raises `USING ERRCODE = 'check_violation', CONSTRAINT = 'ledger_transfers_balanced'` (a fixed name, not `TG_NAME`, for both triggers; R7) when the count is `< 2` or the sum is `<> 0`
    - it returns `NULL`
  - `CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transfer_balanced()`, and the same as `ledger_transfers_balanced` on `ledger_transfers`
  - `ledger_transfers_append_only` and `ledger_entries_append_only`: `BEFORE UPDATE OR DELETE ... FOR EACH ROW EXECUTE FUNCTION reject_change()`
  - `ledger_transfers_no_truncate` and `ledger_entries_no_truncate`: `BEFORE TRUNCATE ... FOR EACH STATEMENT EXECUTE FUNCTION reject_change()`

  At the start of `down()`, drop the six triggers and the function.

- [x] T032 [US1] Run `pnpm run build && pnpm exec vitest run --config ./vitest.config.e2e.ts test/schema/migrations.e2e-spec.ts` until it passes. Then run `for i in 1 2 3 4 5; do pnpm run migration:revert; done && pnpm run migration:run` locally as a second check (quickstart step 4).
- [x] T033 [US1] Write `src/database/entities.spec.ts` (R10):
  - load every `src/**/*.entity.ts` with `import.meta.glob(..., { eager: true })`
  - build the metadata without connecting, through a test-only `class MetadataDataSource extends DataSource { build() { return this.buildMetadatas(); } }` built from `buildTypeOrmOptions('postgres://metadata-only')` (no connection is opened)
  - assert the 13 table names
  - assert that every check, unique, index and foreign key name in `contracts/schema-rules.md` (tables `companies` to `ledger_entries`, excluding triggers, seeds and required-column rows) exists in the metadata
  - run `pnpm run test:cov` and check that the entity files and `safe-bigint.ts` are at 100%

**Checkpoint**: The schema exists and reverts cleanly. The MVP is usable by the next feature.

---

## Phase 4: User Story 2 - The database rejects bad catalog and deal data (Priority: P1)

**Goal**: Every catalog, deal, company and settings rule is proven against the real database.

**Independent Test**: `pnpm exec vitest run --config ./vitest.config.e2e.ts test/schema/catalog-deals.e2e-spec.ts` passes. Each rule has a "rejects" test that asserts the rule name with `expectRule`, and a "passes" test.

- [x] T034 [US2] Create `test/schema/catalog-deals.e2e-spec.ts` with `openTestDataSource()` in `beforeAll` and `destroy()` in `afterAll`. Add a `companies` block covering:
  - each rule of the contract's `companies` section
  - required columns via `expectNotNull`
  - the edge case: `Sales@Acme.com` exists, and `sales@acme.com` is rejected by `companies_email_lower_key`
  - an email of 255 characters, `a@`, `@b` and `a b@c` are each rejected by `companies_email_format`
- [x] T035 [US2] In the same file, add a `platform_settings` block: each `platform_settings_<column>_check` and `platform_settings_single_row` (inserting `id = 2` is rejected). Run updates inside a transaction that is rolled back, so the shared seed row never changes.
- [x] T036 [US2] In the same file, add a `lots` block:
  - each rule of the contract's `lots` section
  - Story 2 scenario 7: a company without a wallet cannot create a lot (`lots_seller_company_id_fkey`); after its wallet is inserted, the same insert passes
  - the default status is `hidden`
- [x] T037 [US2] In the same file, add a `lot_photos` block:
  - each rule
  - Story 2 scenario 4: swapping positions 0 and 1 of two photos in one transaction commits, and the same swap with `SET CONSTRAINTS ALL IMMEDIATE` is rejected by `lot_photos_lot_id_position_key`
  - Story 2 scenario 3 (second half): deleting a lot without deals deletes its photos
- [x] T038 [US2] In the same file, add a `lot_price_changes` block:
  - each rule, including a second creation row for the same lot rejected by `lot_price_changes_creation_key`, and `old = new` rejected by `lot_price_changes_price_changed`
  - Story 2 scenario 8: an `UPDATE` is rejected by `lot_price_changes_append_only`; a direct `DELETE` is rejected by `lot_price_changes_append_only`; deleting the lot (no deals) removes its history rows
- [x] T039 [US2] In the same file, add a `deals` block:
  - each rule of the contract's `deals` section
  - Story 2 scenario 1: buyer equals seller is rejected by `deals_buyer_not_seller`
  - Story 2 scenario 2: seller B on seller A's lot is rejected by `deals_lot_seller_fkey`
  - Story 2 scenario 3: deleting a lot with a deal is rejected by `deals_lot_seller_fkey`
  - Story 2 scenario 7: a buyer or seller without a wallet is rejected by `deals_buyer_company_id_fkey` or `deals_seller_company_id_fkey`
  - the idempotency edge case: the same key for one buyer is rejected by `deals_buyer_idempotency_key_key`, and the same key for two buyers passes
  - `shipped` without `confirmation_due_at` is rejected by `deals_shipped_has_deadline`
- [x] T040 [US2] In the same file, add a `deal_status_changes` block:
  - each rule
  - Story 2 scenario 6: `UPDATE` and `DELETE` are rejected by `deal_status_changes_append_only`
  - `reason` of only spaces for `refunded` is rejected by `deal_status_changes_reason_required`
  - a second `from_status IS NULL` row for one deal is rejected by `deal_status_changes_creation_key`
- [x] T041 [US2] In the same file, add an `invoices` block:
  - each rule
  - Story 2 scenario 5: a second invoice for one deal is rejected by `invoices_deal_id_key`
  - a default number matches `^INV-[0-9]{4}-[0-9]{6,}$`
  - `due_at < issued_at` and `expires_at < due_at` are rejected by `invoices_dates_ordered`
  - `paid` without `paid_at`, and `issued` with `paid_at`, are rejected by `invoices_paid_at_matches_status`
- [x] T042 [US2] Run `test/schema/catalog-deals.e2e-spec.ts`. For each failing rule, fix the entity or the migration of US1 (Conventions), then rerun it and `pnpm run migration:check`.

**Checkpoint**: Catalog and deal rules hold without application code.

---

## Phase 5: User Story 3 - The database protects the money (Priority: P1)

**Goal**: Every account, top-up, correction and ledger rule is proven, including the deferred zero-sum check.

**Independent Test**: `pnpm exec vitest run --config ./vitest.config.e2e.ts test/schema/money.e2e-spec.ts` passes.

- [x] T043 [P] [US3] Create `test/schema/money.e2e-spec.ts` with an `accounts` block:
  - each rule of the contract's `accounts` section
  - the seed: exactly one `escrow` and one `bank_clearing` row
  - Story 3 scenario 8: a wallet balance below 0 is rejected by `accounts_balance_not_negative`, and a bank clearing balance above 0 by `accounts_bank_clearing_not_positive`. Run these updates in a rolled-back transaction, because the platform accounts are shared.
  - a third platform account is rejected by `accounts_platform_type_key`
  - a second wallet for one company is rejected by `accounts_company_id_key`
  - a wallet without a company, or a platform account with a company, is rejected by `accounts_company_matches_type`
  - `DELETE` of the escrow account, `UPDATE` of `type`, and moving a wallet to another company are rejected by `accounts_identity_immutable`, while an `UPDATE` of `balance_minor` alone passes
  - deleting a company with a wallet is rejected by `accounts_company_id_fkey`
- [x] T044 [US3] In the same file, add a `top_ups` block:
  - each rule
  - Story 3 scenario 7: a duplicate `TRX-…` is rejected by `top_ups_bank_reference_key`
  - `' trx-1'` and `'trx-1'` are rejected by `top_ups_bank_reference_normalized`
  - a company without a wallet is rejected by `top_ups_company_id_fkey`
- [x] T045 [US3] In the same file, add a `corrections` block:
  - each rule
  - Story 3 scenario 9: a duplicate `idempotency_key` is rejected by `corrections_idempotency_key_key`
  - a company without a wallet is rejected by `corrections_company_id_fkey`
- [x] T046 [US3] In the same file, add a `ledger_transfers` block:
  - each check, unique and foreign key rule
  - no source, or two sources, are rejected by `ledger_transfers_one_source`
  - a `payout` that points to a top-up is rejected by `ledger_transfers_deal_matches_type`
  - Story 3 scenario 4: a second `invoice_payment` for one invoice is rejected by `ledger_transfers_invoice_payment_key`
  - Story 3 scenario 5: a `refund` after a `payout` for one deal is rejected by `ledger_transfers_deal_settlement_key`
  - Story 3 scenario 6: `UPDATE` and `DELETE` are rejected by `ledger_transfers_append_only`, and `TRUNCATE` by `ledger_transfers_no_truncate`
  - a transfer committed with no entries is rejected by `ledger_transfers_balanced`
- [x] T047 [US3] In the same file, add a `ledger_entries` block. Use `writeTransfer` inside `dataSource.transaction()` and assert at commit:
  - Story 3 scenario 1: +100/−100 commits
  - Story 3 scenario 2: +100/−90 is rejected by `ledger_transfers_balanced`, and afterwards no row of that transfer exists
  - Story 3 scenario 3: a single entry is rejected by `ledger_transfers_balanced`
  - an entry added in a new transaction to a transfer that is already committed and balanced is rejected by `ledger_transfers_balanced` (the entries trigger)
  - +50/+50/−100 commits
  - an entry of 0 is rejected by `ledger_entries_amount_not_zero`
  - two transfers in one transaction where one is unbalanced: the whole commit is rejected
  - entries inserted in three separate statements before commit pass (the check runs at commit)
  - `UPDATE`, `DELETE` and `TRUNCATE` are rejected by `ledger_entries_append_only` and `ledger_entries_no_truncate`
  - SC-004: after the file runs, `SELECT` finds no transfer with fewer than 2 entries or a non-zero sum
- [x] T048 [US3] Run `test/schema/money.e2e-spec.ts`. Fix failing rules in the US1 entities or migrations (Conventions), then rerun it and `pnpm run migration:check`.

**Checkpoint**: Money cannot be created, destroyed, duplicated or rewritten by a buggy service.

---

## Phase 6: User Story 4 - Later features read and write the tables from code (Priority: P2)

**Goal**: Every table round-trips through its entity and repository, and money stays exact or fails loudly.

**Independent Test**: `pnpm exec vitest run --config ./vitest.config.e2e.ts test/schema/entities.e2e-spec.ts` passes.

- [x] T049 [P] [US4] Create `test/schema/entities.e2e-spec.ts`:
  - **Story 4 scenario 1:** for each of the 13 entities, `save()` a fully filled row through `dataSource.getRepository(...)` and `findOneByOrFail` it. Compare every property. Ledger rows go in one `dataSource.transaction()` with a balanced transfer.
  - **Story 4 scenario 2 and SC-005:** `unit_price_minor = 9007199254740991` and `1` round-trip exactly, and so do 1,000 random safe amounts saved as lots of one seller.
  - **Story 4 scenario 3:** raw SQL `UPDATE lots SET unit_price_minor = 9007199254740992` on a test lot, then `findOneBy` rejects with `RangeError`.
  - **FR-022:** for `Company`, `Lot`, `Deal` and `PlatformSettings`, a second `save()` changes `updatedAt`. Run the `PlatformSettings` case in a rolled-back transaction, because its row is shared.
  - **SC-006:** a test that writes a deal and its invoice with two `save()` calls and no raw SQL.

**Checkpoint**: The next feature can use repositories directly.

---

## Phase 7: User Story 5 - The pipeline catches schema drift (Priority: P2)

**Goal**: `pnpm run ci` fails when entities and migrations disagree, or when an entity is not registered.

**Independent Test**: The drift test passes on a clean tree. After a column is added to an entity without a migration, it fails and prints the missing SQL.

- [x] T050 [P] [US5] Create `test/schema/drift.e2e-spec.ts` (R11) with two tests:
  - **Drift:** `openTestDataSource()`, then `await dataSource.driver.createSchemaBuilder().log()`. Assert `upQueries` is empty. The failure message lists every `query` of `upQueries`.
  - **Registration:** boot `Test.createTestingModule({ imports: [AppModule] })`, as `test/app.e2e-spec.ts` does. Assert that the set of `app.get(DataSource).entityMetadatas.map((m) => m.target)` equals the set of `entityClasses()` from `test/schema/helpers.ts`, and that `app.get(DataSource).options.synchronize` is not `true` (FR-001). Boot once in `beforeAll` and close the app in `afterAll`.
- [x] T051 [US5] Prove that the drift check works (Story 5 scenario 2):
  1. Add a temporary `@Column({ type: 'text', name: 'drift_probe', nullable: true })` to `src/companies/company.entity.ts`.
  2. Run the drift test and `pnpm run migration:check`. Both must fail and show `ALTER TABLE "companies" ADD "drift_probe" text`.
  3. Remove the column, and confirm both pass again.
  4. Temporarily remove `Company` from `companies.module.ts`, and confirm the registration test fails. Restore it.

**Checkpoint**: Drift and missing registration cannot reach `main`.

---

## Phase 8: User Story 6 - The current-state docs show the schema (Priority: P3)

**Goal**: All three ERD copies and the README match the built schema (FR-028, FR-029). Feature 001's text was updated in Phase 1 (T007, T008); update it again here if US2 or US3 changed the schema.

**Independent Test**: Quickstart step 6. The `cmp` checks print nothing, the v1 folder is unchanged, and the README shows the ERD.

- [x] T052 [US6] Update the draw.io ERD (R15) with a Node script in `$TMPDIR/erd-update/` (not in the repo):
  1. Parse the uncompressed `<mxfile>` from the `content` attribute of `specs/001-marketplace-data-model/erd.drawio.svg`.
  2. Make the T007 changes: the `email` row, the `idempotency_key` rows, the `lot_price_changes` table in the Catalog group, the re-pointed edges and the cardinality ends.
  3. Re-render the SVG with `@resvg/resvg-js`, with DejaVu fonts (`dejavu-fonts-ttf`, `loadSystemFonts: false`) and `npm install --cache "$TMPDIR/npm-cache"`.
  4. Write the file back, and render a PNG to check: no overlaps, no edge through a table, every label readable.
- [x] T053 [US6] Copy `specs/001-marketplace-data-model/erd.drawio.svg` to `docs/system-design/marketplace-v2/erd.drawio.svg` and to `docs/architecture/erd.drawio.svg`. Run `cmp` on both copies (expected: no output), and `git diff main -- docs/system-design/marketplace-v1` (expected: empty).
- [x] T054 [US6] In the `README.md` Architecture section, after the container diagram, add one short paragraph saying the marketplace tables exist but no feature uses them yet, and `![Marketplace data model](docs/architecture/erd.drawio.svg)`. In `docs/system-design/marketplace-v2/README.md`, update the "Data model" text only where it names the changed rules (zero or one wallet, price history). Run `pnpm exec prettier --write README.md docs/system-design/marketplace-v2/README.md specs/001-marketplace-data-model`.

**Checkpoint**: Docs match the schema.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [x] T055 [P] Update `AGENTS.md`:
  - **Commands:** add `pnpm run migration:check` with a one-line description.
  - **Architecture, entities:** they reference each other by id with a named `@ForeignKey`, and every rule name comes from `specs/002-marketplace-schema/contracts/schema-rules.md`.
  - **Architecture, shared options:** every `DataSource` starts from `buildTypeOrmOptions(url)`, and database tests open one from it instead of booting `AppModule`.
  - **Architecture, triggers:** they only reject writes. History rows, status changes and money moves are service code.
  - **Architecture, money:** `bigint` columns use `safeBigint`, and raw sums use `parseSafeBigint`.
  - **Architecture, `updated_at`:** it is set by TypeORM, so raw SQL updates must set it.
  - **Architecture, migrations:** hand-written SQL goes at the end of `up()` and the start of `down()`, except objects a table needs at creation (function defaults), which go first.
  - **Architecture, checks:** the drift and registration tests are in `test/schema/drift.e2e-spec.ts`.

  Keep the existing tone and length. Run `pnpm exec prettier --write AGENTS.md`.

- [x] T056 [P] Traceability check (SC-001): a one-off shell command (not committed) that extracts every backticked rule name from the tables of `specs/002-marketplace-schema/contracts/schema-rules.md` and greps `test/schema/` for each. Every name except plain indexes (`*_idx`) must appear in a test. Indexes are covered by `entities.spec.ts` and the round-trip snapshot. Add any missing test.
- [x] T057 Run quickstart steps 1–6 from `specs/002-marketplace-schema/quickstart.md` against the local database, and fix any mismatch between the quickstart and the real output
- [x] T058 Run `pnpm run ci` (the `ci` script in `package.json`; Docker must run). If it fails, fix and rerun, or report the task as unfinished with the failing output. Do not weaken a check (Constitution I).
- [x] T059 Mark finished tasks `[X]` in `specs/002-marketplace-schema/tasks.md`, then ask the user before committing. On approval, stage by explicit path and commit with a Conventional Commits message (`feat(database): ...`). The paths: `src/`, `test/`, `package.json`, `AGENTS.md`, `README.md`, `docs/architecture/erd.drawio.svg`, `docs/system-design/marketplace-v2/`, `specs/001-marketplace-data-model/`, `specs/002-marketplace-schema/`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: needs T002–T004 (the spike uses `safeBigint` and the shared options). Blocks all stories.
- **US1 (Phase 3)**: needs Phase 2. Blocks US2–US5, because they test the tables US1 builds.
- **US2, US3, US4, US5**: need US1. They are independent of each other, in different test files.
- **US6 (Phase 8)**: the ERD picture and README; needs US1 (the final schema). Best after US2 and US3, because their fixes may change the schema.
- **Polish (Phase 9)**: needs all stories.

### Within US1

- The migrations are strictly sequential, in foreign key order: T016 → T018 → T022 → T026 → T031. Each needs the previous one applied locally.
- The entities of one area can be written in parallel ([P]) before their migration task.
- T011 (the round-trip test) is written first and passes at T032.

### Parallel Opportunities

- Setup: T002, T003, T005, T006, T007, T008.
- US1 entity groups: {T012, T013, T014}, {T019, T020, T021}, {T023, T024, T025}, {T027, T028, T029, T030}. T017 can be written any time before T018.
- After US1: T043 (US3), T049 (US4) and T050 (US5) start in parallel with US2.
- Polish: T055 and T056.

## Parallel Example: User Story 1, ledger area

```bash
Task: "Create the TopUp entity in src/ledger/top-up.entity.ts"
Task: "Create the Correction entity in src/ledger/correction.entity.ts"
Task: "Create the LedgerTransfer entity in src/ledger/ledger-transfer.entity.ts"
Task: "Create the LedgerEntry entity in src/ledger/ledger-entry.entity.ts"
# then T031 generates the CreateLedger migration
```

## Implementation Strategy

### MVP first (US1)

1. Phases 1 and 2. The spike must pass before any real entity.
2. Phase 3: all tables, migrations, triggers and seeds, plus the round-trip and metadata tests.
3. Stop and validate: quickstart steps 1, 2 and 4.

### Incremental delivery

1. US2 and US3 (P1): the rule tests. Fixes go into the US1 migrations in place.
2. US4 and US5 (P2): code mapping and drift.
3. US6 (P3): documentation.
4. Polish, then `pnpm run ci`, then ask before committing.

## Notes

- Estimated effort, one developer: Setup and spike 1–2 h, US1 3–4 h, US2 and US3 3–4 h, US4 and US5 1–2 h, US6 1–2 h, Polish 1 h.
- Run Docker-dependent commands (`docker:up`, `migration:*`, `test:e2e`, `ci`) with Docker running.
- Commit only after T059's approval; do not commit reviews (`reports/` is ignored).
