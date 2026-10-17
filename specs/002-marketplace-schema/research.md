# Research: Marketplace Schema

Decisions for building the schema of [feature 001](../001-marketplace-data-model/data-model.md) with the changes from this feature's [Clarifications](./spec.md#clarifications). The facts about TypeORM come from the installed version, 1.1.1 (`node_modules/typeorm`).

## R1. One feature module per area of the data model

- **Decision**: Five modules, each registering its entities with `TypeOrmModule.forFeature([...])` and exporting `TypeOrmModule`, so later services in the same area inject the repositories:

  | Module                   | Folder                   | Entities                                                          |
  | ------------------------ | ------------------------ | ----------------------------------------------------------------- |
  | `CompaniesModule`        | `src/companies/`         | `Company`                                                         |
  | `CatalogModule`          | `src/catalog/`           | `Lot`, `LotPhoto`, `LotPriceChange`                               |
  | `DealsModule`            | `src/deals/`             | `Deal`, `DealStatusChange`, `Invoice`                             |
  | `LedgerModule`           | `src/ledger/`            | `Account`, `LedgerTransfer`, `LedgerEntry`, `TopUp`, `Correction` |
  | `PlatformSettingsModule` | `src/platform-settings/` | `PlatformSettings`                                                |

  `AppModule` imports all five. `autoLoadEntities: true` in `DatabaseModule` then loads every entity.

- **Rationale**: Constitution IV asks for entities per feature module. The groups match the colour groups of the feature 001 ERD, and the later services (purchase, top-up, payout) map onto them. `accounts` sits in the ledger because every rule about it is a money rule.
- **Alternatives considered**: One `MarketplaceModule` for all tables: simpler now, but each later feature would edit one shared module. A module per table: 13 modules with no logic yet.

## R2. Entities reference each other by id, with `@ForeignKey`, not relation decorators

- **Decision**: Every foreign key is a plain `@Column` (`uuid`) plus a `@ForeignKey` decorator with an explicit name. Composite keys use the class-level form: `@ForeignKey(() => Lot, ['lotId', 'sellerCompanyId'], ['id', 'sellerCompanyId'], { name: 'deals_lot_seller_fkey', onDelete: 'RESTRICT' })`. No `@ManyToOne` and no navigation properties in this feature. There is no hand-written list of entities: the app loads them through the five `forFeature` calls, the CLI by the `*.entity.js` glob in `data-source.ts`, and the tests by the matching source glob (R10, R11).
- **Rationale**:
  - `deals.seller_company_id` is part of two foreign keys: the composite one to `lots (id, seller_company_id)` and the one to `accounts (company_id)` (FR-006a). Two relation decorators that share a join column are a fragile area of TypeORM. `@ForeignKey` declares exactly the constraint and nothing else.
  - Five foreign keys point to `accounts.company_id`, a non-primary unique column. `@ForeignKey` accepts the referenced column names directly.
  - With `emitDecoratorMetadata`, a relation property typed as another entity emits `design:type` for that class when the module loads. Under ESM, two entity files that import each other then fail with a temporal dead zone error (TypeORM's `Relation<T>` type works around it). Id columns have no such import.
  - Referring by id is the usual aggregate style; later features add relations where a join needs them.
- **Alternatives considered**: Relation decorators everywhere: navigation properties for free, but the shared join column and the import cycles above. Raw SQL foreign keys in migrations only: the drift check would see them as foreign keys that the entities lack and generate `DROP` statements (R11).

## R3. One shared function builds the TypeORM options of every `DataSource`

- **Decision**: `src/database/typeorm-options.ts` exports `buildTypeOrmOptions(url)`, which returns `{ type: 'postgres', url, uuidExtension: 'pgcrypto', installExtensions: false }`. `DatabaseModule` (which adds the pool size, the logger and `autoLoadEntities`), `data-source.ts` (entity and migration globs), `global-setup.ts`, the round-trip test and the test helpers all start from it. Database tests therefore connect with the same options code as the app, which constitution 1.1.0 (Principle II) requires when a test opens its own `DataSource`.
- **Rationale**: With `uuidExtension: 'pgcrypto'`, TypeORM uses `gen_random_uuid()` for `@PrimaryGeneratedColumn('uuid')`, which is built into PostgreSQL 13 and later (R6 of feature 001). The default (`uuid-ossp`) would need an extension and generate `uuid_generate_v4()`. `installExtensions: false` stops the driver from running `CREATE EXTENSION` at connect. Every `DataSource` must agree, or the drift check compares different defaults.
- **Alternatives considered**: `@PrimaryColumn` with `default: () => 'gen_random_uuid()'`: no shared option, but TypeORM no longer treats the key as generated, so `save()` does not return the new id reliably. A shared constant spread into each `DataSource`: works, but each place still writes `type` and `url` itself, and nothing forces a new `DataSource` to include the constant.

## R4. Five migrations, in foreign key order

- **Decision**:

  | #   | Migration                    | Tables                                                         | Hand-written SQL                                                                                                                      |
  | --- | ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
  | 1   | `CreateCompaniesAndAccounts` | `companies`, `accounts`                                        | `lower(email)` unique index; shared function `reject_change()`; account guard triggers; seed of the `escrow` and `bank_clearing` rows |
  | 2   | `CreatePlatformSettings`     | `platform_settings`                                            | seed of the single row                                                                                                                |
  | 3   | `CreateCatalog`              | `lots`, `lot_photos`, `lot_price_changes`                      | append-only guard on `lot_price_changes` (delete allowed only through the lot's cascade)                                              |
  | 4   | `CreateDeals`                | `deals`, `deal_status_changes`, `invoices`                     | sequence and function for invoice numbers; append-only guard on `deal_status_changes`                                                 |
  | 5   | `CreateLedger`               | `top_ups`, `corrections`, `ledger_transfers`, `ledger_entries` | append-only and `TRUNCATE` guards; the two deferred zero-sum constraint triggers                                                      |

  Each migration is generated with `pnpm run migration:generate` after the area's entities exist, then extended by hand: extra SQL at the end of `up()`, and its reverse at the start of `down()`. Then `pnpm run format`.

- **Rationale**: Each migration depends only on earlier ones (lots need `accounts.company_id`, the ledger needs invoices and deals). One migration per area keeps a review readable, and `migration:revert` steps back one area at a time. Generating keeps the SQL identical to what TypeORM expects, which the drift check needs.
- **Alternatives considered**: One migration with everything: a single 600-line file. A migration per table: 13 files, and the foreign key order still has to be planned by hand.

## R5. Every rule has a stable name

- **Decision**: Names follow PostgreSQL's own conventions plus a rule word: `<table>_<column>_check` for value lists and ranges, `<table>_<rule>` for multi-column checks (`deals_buyer_not_seller`), `<table>_<columns>_key` for unique rules, `<table>_<columns>_fkey` for foreign keys, `<table>_<columns>_idx` for plain indexes, and the trigger name for trigger rules. Every decorator passes its name (`@Check(name, expr)`, `@Unique(name, cols)`, `@Index(name, ...)`, `@ForeignKey(..., { name })`). Triggers raise with `RAISE EXCEPTION ... USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME`, so `pg` reports the trigger name in `error.constraint`, like any other rule. One exception: `check_transfer_balanced()` always raises the fixed rule name `ledger_transfers_balanced`, whichever of its two triggers fires (R7). Value lists come from `as const` arrays in the entity files (for example `ACCOUNT_TYPES`), which feed both the TypeScript union type and the `CHECK` text.
- **Rationale**: FR-018. A test asserts the exact rule name, so it fails when a different rule rejects the row by accident. TypeORM matches checks, indexes and foreign keys by name (R11), so generated names would churn on every change.

## R6. `bigint` columns map to a safe JS `number`

- **Decision**: `src/database/safe-bigint.ts` exports:
  - `safeBigint`, a `ValueTransformer`. `to()` passes `null`/`undefined` through and throws a `RangeError` unless the value is a safe integer. `from()` turns the `pg` string into a number and throws a `RangeError` unless it is a safe integer.
  - `parseSafeBigint(value: string | null)` for raw query results such as `SUM(amount_minor)`, which PostgreSQL returns as `numeric` and `pg` as a string.

  All `*_minor` columns use `safeBigint`. The identity keys (`ledger_entries.id`, `deal_status_changes.id`, `lot_price_changes.id`) stay `string`, as `pg` returns them (spike result, R13).

- **Rationale**: FR-021 and the user's Q1 choice. Identity keys are opaque ids, never used in arithmetic, so `string` is exact and needs no transformer.
- **Alternatives considered**: `pg.types.setTypeParser(20, Number)`: global, and it rounds silently above 2^53.

## R7. Triggers only reject writes

- **Decision**: Five trigger functions, all `plpgsql`:

  | Function                     | Triggers                                                                                                                                                                                     | Rejects                                                                                                          |
  | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
  | `reject_change()`            | `BEFORE UPDATE OR DELETE` on `ledger_transfers`, `ledger_entries`, `deal_status_changes`; `BEFORE TRUNCATE` on `ledger_transfers`, `ledger_entries`                                          | any change                                                                                                       |
  | `reject_account_change()`    | `BEFORE UPDATE OR DELETE` on `accounts`                                                                                                                                                      | a delete, or an update where `type` or `company_id` is distinct from the old value                               |
  | `reject_price_change_edit()` | `BEFORE UPDATE OR DELETE` on `lot_price_changes`                                                                                                                                             | any update; a delete while the lot still exists (only the cascade of the lot's delete finds the lot gone)        |
  | `check_transfer_balanced()`  | `CONSTRAINT TRIGGER ... AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED FOR EACH ROW` on `ledger_entries` (`ledger_entries_balanced`) and on `ledger_transfers` (`ledger_transfers_balanced`) | a transfer whose number of entries differs from its `entry_count` (at least 2), or whose sum is not 0, at commit |

- **Rationale**: Spec Assumptions: a trigger may only say "no". The zero-sum check needs both triggers: the one on transfers catches a transfer with no entries at all, where no entry trigger ever fires (SC-004), and the one on entries catches entries added later to a transfer that an earlier transaction committed (append-only blocks `UPDATE` and `DELETE`, not `INSERT`). A balanced pair added later keeps the sum at 0, so the transfer declares its entry count (`entry_count`) and the check compares the two; the count cannot be edited, because the table is append-only (rejected: comparing `xmin` with the current transaction id, which fails inside savepoints, and comparing `created_at` with `transaction_timestamp()`, which fails when `created_at` is set by hand). For an unbalanced new transfer both triggers fail, and PostgreSQL stops at whichever deferred trigger runs first. So the function raises one fixed rule name, `ledger_transfers_balanced`, instead of `TG_NAME`: the reported rule never depends on firing order, and a service maps one name to one error. `TRUNCATE` bypasses row triggers, so the ledger gets a statement trigger too. The price-history guard allows a delete only when the lot row is already gone: the lot's `ON DELETE CASCADE` runs after the lot is deleted, so it passes, and any other delete, direct or from inside another trigger, is rejected. Checking `pg_trigger_depth() > 1` instead would let through a delete from any trigger, not only the cascade.
- **Alternatives considered**: A `CHECK` with a subquery: not allowed in PostgreSQL. A statement-level `AFTER` trigger with transition tables: it runs before commit, so it rejects a transfer that is still being written.

## R8. Invoice numbers from a sequence through a function default

- **Decision**: Migration 4 creates `invoice_number_seq` and `next_invoice_number()`, which calls `nextval` once and returns `'INV-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-' || lpad(n::text, greatest(6, length(n::text)), '0')`. The column default is `next_invoice_number()` (`default: () => 'next_invoice_number()'`). A check `invoices_number_format` requires `^INV-[0-9]{4}-[0-9]{6,}$`.
- **Rationale**: `lpad(n, 6)` alone cuts a 7-digit number to 6 digits, which would collide (spec edge case). A function calls `nextval` once and pads only short numbers. The year comes from UTC so it does not depend on the session's time zone. TypeORM does not inspect standalone sequences or functions, so they do not disturb the drift check.

## R9. Index and unique rules TypeORM cannot express directly

- **Decision**:
  - `lower(email)` unique: created by hand in migration 1, declared on `Company` as `@Index('companies_email_lower_key', { synchronize: false })`, so the drift check neither creates nor drops it.
  - Partial unique indexes (`accounts_platform_type_key`, the ledger and price-history ones) and partial plain indexes: `@Index(name, cols, { unique, where })`.
  - `lot_photos (lot_id, position)`: `@Unique('lot_photos_lot_id_position_key', ['lotId', 'position'], { deferrable: 'INITIALLY DEFERRED' })`.
- **Rationale**: These are the remaining parts of data-model.md that need special handling; everything else is a plain decorator.

## R10. Entity files are covered by a metadata unit test

- **Decision**: `src/database/entities.spec.ts` loads the exported classes of every `src/**/*.entity.ts` file with Vite's `import.meta.glob(..., { eager: true })`, as `global-setup.ts` already does for migrations. It builds their metadata without a database connection: a small subclass of `DataSource` exposes the protected `buildMetadatas()`. The test then checks that:
  - the glob finds exactly the 13 expected tables
  - the named checks, uniques, indexes and foreign keys exist
- **Rationale**: Coverage counts only unit tests, and it includes every file under `src/`. Building the metadata runs the decorators and the `() => Lot` type functions, so entity files reach full coverage without excluding them, which would weaken a check (Constitution I). It is also a fast check that every rule is declared.
- **Alternatives considered**: Excluding `*.entity.ts` from coverage: it would hide entity code from the threshold.

## R11. The drift check

- **Decision**:
  - **In CI:** `test/schema/drift.e2e-spec.ts` opens a `DataSource` with the globbed entities (`src/**/*.entity.ts`, the same set the CLI finds) on the migrated test database and calls `dataSource.driver.createSchemaBuilder().log()`. The test fails, printing the SQL, unless `upQueries` is empty. This is the same computation as `typeorm migration:generate --check`. It needs no extra container and runs inside `test:e2e`, so it is part of `pnpm run ci` (Constitution I).
  - **Registration check:** the same file boots `AppModule` and asserts that `app.get(DataSource).entityMetadatas` covers exactly the globbed classes. A glob alone cannot see an entity that no module registers: the CLI would still create its table, but the app would have no repository for it.
  - **Locally:** a new `migration:check` script, `pnpm run build && typeorm migration:generate src/database/migrations/SchemaDrift --check -d dist/database/data-source.js`, against the docker-compose database.
- **Rationale**: The CLI form needs a database migrated to the newest migration, which CI has only inside the Testcontainers run.
- **Known limit**: TypeORM matches checks and indexes by name only. A check whose expression changes under the same name is not reported. The rule tests catch that case, because they test the behaviour, not the definition.

## R12. `updated_at` is maintained by TypeORM

- **Decision**: `@UpdateDateColumn({ type: 'timestamptz' })` on `companies`, `lots`, `deals` and `platform_settings`. TypeORM sets it on `save()` and on query builder updates.
- **Rationale**: FR-022 asks for a changed timestamp on every update. A trigger would write data, which the spec's trigger rule excludes. Raw SQL updates must set the column themselves; AGENTS.md says so.

## R13. A spike first

- **Decision**: The first implementation task builds two throwaway entities that use every risky mapping: the composite foreign key to a non-primary unique pair, a foreign key to `accounts.company_id`, the `synchronize: false` expression index, the deferrable unique, a function default and a `safeBigint` identity key. It generates a migration and runs the drift check against it. Only after that check returns no SQL do the real entities follow. The spike files are deleted afterwards.
- **Rationale**: If TypeORM 1.1.1 handles one of these differently, the drift check would fail late, after 13 entities. The fallback for any mapping that fails is a hand-written SQL object with `synchronize: false` (for indexes) or a documented change of approach in this file.
- **Spike result (2026-10-17)**: `migration:check` reported no changes after the spike migration ran, and it reverted cleanly. Two findings changed the plan:
  - `@PrimaryGeneratedColumn('identity', ...)` does not accept a `transformer` (TS2769). Identity keys are therefore typed `string` (R6).
  - Without `primaryKeyConstraintName`, TypeORM names primary keys with a hash (`PK_6d104e…`). Every primary key sets `primaryKeyConstraintName: '<table>_pkey'`.

  Confirmed as planned: the class-level composite `@ForeignKey` to a non-primary unique pair, a second `@ForeignKey` on the same column to a nullable unique column, the `synchronize: false` expression index created by hand, `@Unique(..., { deferrable: 'INITIALLY DEFERRED' })`, a partial `@Index` with `where`, a function default created at the start of `up()`, and `gen_random_uuid()` from `buildTypeOrmOptions()`.

## R14. Test strategy

- **Decision**:
  - **Connections:** `test/schema/helpers.ts` opens one `DataSource` per test file on the migrated database, built with `buildTypeOrmOptions()` and the globbed entities. Schema tests are database tests, so they do not boot `AppModule` (constitution 1.1.0, Principle II). The registration test in `drift.e2e-spec.ts` is the one that boots it.
  - **Fixtures:** helpers create a company with or without a wallet, a lot, a deal, an invoice and a top-up, with random unique values (registration number, email, bank reference, idempotency key), so tests never share rows.
  - **Rule assertions:** `expectRule(promise, 'deals_buyer_not_seller')` asserts a `QueryFailedError` whose `driverError.constraint` is that name.
  - **Deferred rules:** tests run in `dataSource.transaction()` and assert at commit.
  - **Round trip:** `migrations.e2e-spec.ts` creates its own database on the same container (`CREATE DATABASE schema_roundtrip_<random>`), so reverting never touches the shared one. It runs apply, revert all, apply, compares catalog snapshots (tables, columns, constraints, indexes, triggers, functions, sequences), then drops the database.
- **Rationale**: Constitution II (real database, own data). Reverting the shared database would break the test files that run in parallel.

## R15. Updating the ERD files

- **Decision**: Update `specs/001-marketplace-data-model/erd.drawio.svg` with a Node script in `$TMPDIR` that edits the uncompressed draw.io model and re-renders the picture with `@resvg/resvg-js` and DejaVu fonts, as feature 001 did. The changes are:
  - the email column
  - `lot_price_changes`
  - the idempotency keys
  - edges from `lots`, `deals`, `top_ups` and `corrections` to `accounts`
  - zero-or-one cardinality between companies and accounts

  Copy the result byte for byte to `docs/system-design/marketplace-v2/erd.drawio.svg` and to `docs/architecture/erd.drawio.svg`, and check with `cmp`.

- **Rationale**: FR-028 and FR-029. The feature 001 generator is gone, so a script that edits the existing model keeps the layout instead of drawing it again.
