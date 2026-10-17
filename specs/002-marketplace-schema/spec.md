# Feature Specification: Marketplace Schema

**Feature Branch**: `002-marketplace-schema`

**Created**: 2026-10-16

**Status**: Draft

**Input**: User description: "Implement the marketplace data model from specs/001-marketplace-data-model/data-model.md as TypeORM entities and migrations. Scope: all 12 tables, every DB constraint from data-model.md (PK, FK with ON DELETE rules, UNIQUE, CHECK, NOT NULL, defaults), the deferred trigger that makes the entries of a ledger transfer sum to 0 (R4), and seed rows (platform_settings, system accounts). Tests run against real Postgres and prove that every constraint rejects bad data. CI fails when the entities and migrations do not match (migration:generate --check). Out of scope: HTTP endpoints and business services."

## Clarifications

### Session 2026-10-17

- Q: What is the company email for: a contact address for the company as a whole, or a login address for a person? → A: A company contact address (billing, notifications), one per company and unique across companies regardless of letter case. People's login emails come later, with the security feature's users.
- Q: Should the database keep the email as typed (`Sales@Acme.com`), or always store it in lower case (`sales@acme.com`)? → A: Store it as typed; a unique index on `lower(email)` makes it unique regardless of letter case.
- Q: Should a company have zero or one wallet, with the database requiring a wallet for lots, deals, top-ups and corrections, and blocking account deletes and identity changes? → A: Yes (A1). A company may exist without a wallet; activating the wallet is a separate step. A lot needs its seller's wallet at creation, a deal needs the wallets of both sides, and top-ups and corrections need the company's wallet. Accounts are never deleted, and their type and company never change.
- Q: Should double-submitted corrections and purchases be blocked by a unique idempotency key stored on the row itself? → A: Yes. `corrections.idempotency_key` is unique; `deals.idempotency_key` is unique per buyer. Both are required UUIDs that the client generates once per submission.
- Q: How should the database keep the history of lot price changes? → A: A new append-only `lot_price_changes` table. The service writes a row when a lot is created and on every price change, in the same transaction, like `deal_status_changes`. The database only rejects bad rows and changes to old rows; no trigger writes data.

## Scope

This feature builds the database schema that feature 001 designed. The source of truth for every table, column and rule is [`specs/001-marketplace-data-model/data-model.md`](../001-marketplace-data-model/data-model.md), with the decisions in its [`research.md`](../001-marketplace-data-model/research.md) (R1–R13). Where this specification changes the design (see Clarifications), this feature updates data-model.md and the ERD first (FR-029), so the data model stays the single source of truth.

In scope:

- The 12 tables of the data model plus `lot_price_changes` (13 in total), created by reversible schema migrations: `companies`, `accounts`, `lots`, `lot_photos`, `deals`, `deal_status_changes`, `invoices`, `ledger_transfers`, `ledger_entries`, `top_ups`, `corrections`, `platform_settings`, `lot_price_changes`.
- Every rule the data model assigns to the database: keys, foreign keys with their delete rules, unique and partial unique rules, check rules, required columns, defaults and indexes.
- The database triggers of R4: the deferred check that the entries of a transfer sum to 0 with at least two entries, and the rejection of changes and deletes on the append-only tables.
- The invoice number source of R6.
- The seed rows: the single platform settings row with its defaults, and the two platform accounts (escrow, bank clearing).
- Data definitions in the application code, one per table, that later features use to read and write the tables.
- Tests against a real database that prove each rule rejects bad data and accepts good data.
- A check in the project's standard pipeline that fails when the data definitions and the migrations disagree.
- The current-state architecture documentation gets the ERD of what this feature built (FR-038 of feature 001).
- The feature 001 design documents and both ERD copies are updated to this feature's design changes (FR-029).

Out of scope:

- HTTP endpoints, business services and background jobs (purchase, payment, expiry, auto-confirmation). The rules that data-model.md assigns to "the service" stay unenforced until those features exist: allowed status transitions, balance equals the sum of entries, invoice amount equals the deal total, stock reservation.
- The reconciliation queries of data-model.md (SC-001 to SC-003 of feature 001). A later health or admin feature runs them.
- Applying migrations to a deployed database. No deployment exists yet; that step comes with the deploy pipeline.
- Users, roles and authentication. The `*_ref` columns stay opaque text.
- A restricted database role for the application (R4 grants). The triggers guard the append-only tables until the deploy or security feature adds the role (FR-023).

## User Scenarios & Testing _(mandatory)_

The users of this feature are the developers of the next features (purchase, top-up, payout) and the reviewers who trust the database to stop bad money data even when a service has a bug. A scenario passes when the database itself, with no application code in between, produces the stated result.

### User Story 1 - A fresh database gets the full schema (Priority: P1)

A developer starts from an empty database and applies the migrations. All 13 tables exist with their rules, and the seed rows are in place. Reverting the migrations removes everything this feature added, and applying them again works.

**Why this priority**: Every other story and every later feature needs the tables. A migration that cannot be reverted breaks the rollback path (Constitution IV).

**Independent Test**: On an empty database, apply all migrations, list the tables and the seed rows, revert all migrations, check that no table of this feature is left, and apply them again.

**Acceptance Scenarios**:

1. **Given** an empty database, **When** all migrations are applied, **Then** the 13 tables exist, `platform_settings` holds exactly one row with the defaults (payment window 5, grace 1, unpaid limit 3, expiry limit 2, look-back 30, confirmation window 14), and `accounts` holds exactly one `escrow` and one `bank_clearing` account, each with balance 0.
2. **Given** the migrated database, **When** all migrations of this feature are reverted, **Then** no table, trigger, function, sequence or index of this feature remains.
3. **Given** the reverted database, **When** the migrations are applied again, **Then** the result is the same as in scenario 1.

---

### User Story 2 - The database rejects bad catalog and deal data (Priority: P1)

A later service has a bug and tries to write a lot with a negative price, a deal where a company buys its own lot, or a deal whose seller does not match the lot. The database rejects each write, so the bad row never exists.

**Why this priority**: The data model moves the most important consistency rules into the database (R3, R8, R10) so that they hold regardless of the service code. They must work before any service is written on top of them.

**Independent Test**: For each catalog and deal rule in the Requirements section, insert one valid row and one row that breaks the rule. The valid row is stored; the breaking row is rejected with the name of the rule it broke.

**Acceptance Scenarios**:

1. **Given** a company with a lot, **When** a deal is inserted with the same company as buyer and seller, **Then** the insert is rejected.
2. **Given** lots of two different sellers, **When** a deal is inserted for a lot of seller A with seller B as the seller, **Then** the insert is rejected.
3. **Given** a lot with a deal, **When** the lot is deleted, **Then** the delete is rejected. **Given** a lot without deals but with photos, **When** the lot is deleted, **Then** the lot and its photos are gone.
4. **Given** a lot with photos at positions 0 and 1, **When** both positions are swapped in one transaction, **Then** the transaction commits.
5. **Given** a deal, **When** a second invoice for the same deal is inserted, **Then** the insert is rejected.
6. **Given** a deal status change row, **When** it is updated or deleted, **Then** the change is rejected.
7. **Given** a company without a wallet, **When** it creates a lot or a deal names it as buyer or seller, **Then** the insert is rejected. **Given** the same company after its wallet is created, **When** the same insert runs, **Then** it is stored.
8. **Given** a lot with price history rows, **When** a row is updated, **Then** the change is rejected. **When** a history row with a new price of 0, or with no old price for a lot that already has history, is inserted, **Then** it is rejected. **When** the lot (without deals) is deleted, **Then** its history rows are deleted with it.

---

### User Story 3 - The database protects the money (Priority: P1)

A later service has a bug and writes a transfer whose entries do not balance, pays an invoice twice, pays out and refunds the same deal, or edits an old ledger entry. The database rejects each of these, so money is never created, destroyed or rewritten.

**Why this priority**: Money rules are the ones a bug must never break (FR-026, FR-030, FR-031 of feature 001). The deferred trigger is the only guard that sees a whole transfer.

**Independent Test**: For each money rule in the Requirements section, run a transaction that breaks it and check that it is rejected, and a transaction that follows it and check that it commits.

**Acceptance Scenarios**:

1. **Given** a company wallet, **When** a transfer with entries +100 and −100 is written in one transaction, **Then** the transaction commits.
2. **Given** a company wallet, **When** a transfer with entries +100 and −90 is written in one transaction, **Then** the commit is rejected and none of its rows exist.
3. **Given** a company wallet, **When** a transfer with a single entry is written, **Then** the commit is rejected.
4. **Given** a paid invoice, **When** a second `invoice_payment` transfer for the same invoice is written, **Then** it is rejected.
5. **Given** a deal with a payout transfer, **When** a refund transfer for the same deal is written, **Then** it is rejected.
6. **Given** any ledger transfer or entry, **When** it is updated or deleted, **Then** the change is rejected.
7. **Given** a top-up with bank reference `TRX-1`, **When** another top-up with bank reference `TRX-1` is inserted, **Then** it is rejected.
8. **Given** a company wallet, **When** its balance is set below 0, **Then** the change is rejected. **Given** the bank clearing account, **When** its balance is set above 0, **Then** the change is rejected.
9. **Given** a correction with idempotency key K, **When** a second correction with key K is inserted, **Then** it is rejected and no money moves twice.

---

### User Story 4 - Later features read and write the tables from code (Priority: P2)

A developer of the purchase feature injects the data access for deals and invoices and writes rows without raw SQL. Every column of every table is available, with the right types, and money amounts come back exactly as they were written.

**Why this priority**: The next features build on these definitions. Without them, each feature would write raw SQL and repeat the column mapping.

**Independent Test**: For each table, write one fully filled row through the application's data definitions, read it back, and compare every field.

**Acceptance Scenarios**:

1. **Given** the migrated database, **When** a row of each of the 13 tables is written and read back through the application's data definitions, **Then** every field matches what was written.
2. **Given** a money amount at the largest value the application supports, **When** it is written and read back, **Then** it is exactly the same value.
3. **Given** a money amount above the largest value the application supports, **When** it is read, **Then** the read fails loudly instead of returning a rounded number.

---

### User Story 5 - The pipeline catches schema drift (Priority: P2)

A developer changes a data definition (adds a column, changes a type) and forgets to write the migration. The project's standard check fails and names the difference, so the drift never reaches the main branch.

**Why this priority**: The tests in Stories 2 and 3 run against the schema the migrations build. If the code expects a different schema, those tests stay green while production code fails.

**Independent Test**: Add a column to one data definition without a migration and run the standard check. It fails. Remove the change and run it again. It passes.

**Acceptance Scenarios**:

1. **Given** data definitions and migrations that match, **When** the standard check runs, **Then** the drift check passes.
2. **Given** a data definition with a column that no migration creates, **When** the standard check runs, **Then** it fails and shows the schema change that is missing.

---

### User Story 6 - The current-state docs show the schema (Priority: P3)

A reader of the README sees the ERD of the tables that exist today, next to the C4 diagrams.

**Why this priority**: Feature 001 kept the ERD out of the current-state docs until the tables exist (its FR-038). This feature makes them exist.

**Independent Test**: Open the README Architecture section and the `docs/architecture/` folder. The ERD is there and matches the migrated schema table by table.

**Acceptance Scenarios**:

1. **Given** this feature is merged, **When** a reader opens the README Architecture section, **Then** it shows the ERD of the 13 tables and says they exist but no feature uses them yet.
2. **Given** the ERD in `docs/architecture/`, **When** it is compared with the migrated schema, **Then** every table, column and relationship matches.

---

### Edge Cases

- A transfer's entries are inserted one by one. Between the inserts the transfer does not balance. The check runs at commit, not per row, so a correct transfer that is written in several statements commits.
- Two transfers in one transaction: one balances, one does not. The commit is rejected as a whole.
- A transfer with three entries (+50, +50, −100) balances and commits. Data-model.md allows two or more entries.
- An entry with amount 0 is rejected, even inside a balanced transfer.
- A transfer that points to no source, or to two sources, is rejected. A transfer whose type does not match its source (a `payout` that points to a top-up) is rejected.
- A third platform account (a second escrow) is rejected. A company wallet without a company, or a platform account with a company, is rejected.
- A company without a wallet is stored. A lot, a deal (as buyer or seller), a top-up or a correction for that company is rejected until its wallet exists.
- Deleting the escrow account before any entry refers to it is rejected. Moving a wallet to another company, or changing an account's type, is rejected.
- A second wallet for the same company is rejected.
- A buyer submits the same purchase twice with one idempotency key: the second deal is rejected. Two different buyers that happen to use the same key both succeed, because the key is unique per buyer.
- A company with email `Sales@Acme.com` exists. A second company with `sales@acme.com` is rejected.
- A bank reference with spaces around it or in lower case (`" trx-1"`) is rejected, because the database stores only the normalized form (R12).
- The invoice number sequence passes 999,999 in a year. The number keeps growing past 6 digits; it is never cut to 6 digits, so it never collides with an earlier number.
- A migration is reverted while the tables hold rows. The revert drops the tables with their rows; that is acceptable on a development or test database. On a deployed database, a revert is a deploy decision, out of scope here.
- A money value larger than the application supports is already in the database (written by raw SQL). Reading it fails loudly (Story 4, scenario 3).
- `deal_status_changes.reason` is empty for a move to `disputed` or `refunded`: rejected. An `actor_ref` is set for a `system` actor, or missing for any other actor: rejected.
- An invoice with `due_at` before `issued_at`, or `expires_at` before `due_at`: rejected. An invoice in status `paid` without `paid_at`, or with `paid_at` in any other status: rejected.
- A deal in `shipped`, `disputed` or `completed` without `confirmation_due_at`: rejected.

## Requirements _(mandatory)_

### Functional Requirements

**Migrations and seed rows**

- **FR-001**: The schema MUST be created only by migrations. Automatic schema sync stays off (Constitution IV).
- **FR-002**: Every migration of this feature MUST be reversible: reverting it removes exactly what it added, including triggers, functions, sequences and seed rows.
- **FR-003**: Migrating an empty database MUST create the single `platform_settings` row with the defaults of data-model.md, and exactly one `escrow` and one `bank_clearing` account with balance 0.
- **FR-004**: The tables, columns, types, required columns and defaults MUST match the "Tables" section of data-model.md. Keys follow R6: `uuid` with a database-generated default for business rows, an identity `bigint` for `ledger_entries`, `deal_status_changes` and `lot_price_changes`. Every `created_at` defaults to the current time.

**Catalog and deal rules** (enforced by the database)

- **FR-005**: `companies`: `name` 1–300 characters; `registration_number` unique; `email` required, at most 254 characters, one `@` with text on both sides and no spaces, stored as typed, and unique across companies regardless of letter case (a unique index on `lower(email)`).
- **FR-006**: `accounts`: `type` is one of `company_wallet`, `escrow`, `bank_clearing`; `company_id` is set exactly when the type is `company_wallet`; `company_id` is unique, so a company has zero or one wallet; a company with a wallet cannot be deleted; one row per platform account type; a company wallet and escrow never below 0; bank clearing never above 0; an account is never deleted, and its `type` and `company_id` never change (only the balance changes).
- **FR-006a**: A company's wallet MUST exist before the company takes part in money: `lots.seller_company_id`, `deals.buyer_company_id`, `deals.seller_company_id`, `top_ups.company_id` and `corrections.company_id` each reference the wallet (`accounts.company_id`), so a row for a company without a wallet is rejected. These references can never match escrow or bank clearing, which have no company.
- **FR-007**: `lots`: `title` 1–200 characters; `unit_price_minor` above 0; `stock_available` 0 or more; `status` is `hidden` or `published`, default `hidden`; `(id, seller_company_id)` unique, as the target of the deal's composite foreign key.
- **FR-008**: `lot_photos`: deleted together with their lot; `storage_key` unique; `original_filename` 1–255 characters; `content_type` is one of `image/jpeg`, `image/png`, `image/webp`; `size_bytes`, `width_px`, `height_px` above 0; `position` 0 or more and unique per lot, checked at commit so photos can be reordered in one transaction.
- **FR-009**: `deals`: `quantity` 1 or more; `unit_price_minor` above 0; `total_minor` equals quantity × unit price; buyer differs from seller; `(lot_id, seller_company_id)` must match a lot and its seller, and a lot with deals cannot be deleted; `status` is one of the 8 deal statuses; a deal in `shipped`, `disputed` or `completed` has a `confirmation_due_at`; `idempotency_key` (`uuid`) is required and unique per buyer (`buyer_company_id`, `idempotency_key`).
- **FR-010**: `deal_status_changes`: `to_status` (and `from_status` when set) is one of the 8 deal statuses; `actor_type` is one of `buyer`, `seller`, `operator`, `system`; `actor_ref` is empty exactly for `system`; `reason` is required for a move to `disputed` or `refunded`; rows are never updated or deleted.
- **FR-010a**: `lot_price_changes` (new, not in data-model.md): `lot_id` references the lot; `old_price_minor` is empty only in the lot's creation row, and at most one row per lot has it empty (a partial unique index); otherwise it is above 0; `new_price_minor` above 0 and different from `old_price_minor`; `actor_type` is `seller` or `operator`; `actor_ref` required; `changed_at` required; index `(lot_id, id)`. Rows are never updated. They are deleted only together with their lot (a lot without deals may be deleted). The service writes the rows; keeping `lots.unit_price_minor` equal to the newest `new_price_minor` is a service rule.
- **FR-011**: `invoices`: one invoice per deal; `number` unique and taken from a database sequence in the format `INV-<year>-<number>`, with the number padded to at least 6 digits; `amount_minor` above 0; `status` is one of `issued`, `paid`, `cancelled`, `expired`; `issued_at ≤ due_at ≤ expires_at`; `paid_at` is set exactly when the status is `paid`.

**Money rules** (enforced by the database)

- **FR-012**: `ledger_transfers`: `type` is one of the 5 transfer types; exactly one source is set (top-up, invoice, deal or correction), and it matches the type; one transfer per top-up and per correction; one `invoice_payment` per invoice; one `payout` or `refund` per deal, never both; `actor_type` and `actor_ref` follow the rule of FR-010.
- **FR-013**: `ledger_entries`: `amount_minor` is not 0; at commit, the entries of each transfer written in the transaction number two or more and sum to 0.
- **FR-014**: `ledger_transfers` and `ledger_entries` rows are never updated or deleted.
- **FR-015**: `top_ups`: `amount_minor` above 0; `bank_reference` unique and stored only in normalized form (trimmed, upper case).
- **FR-016**: `corrections`: `amount_minor` is not 0; `reason` 1–1000 characters; `idempotency_key` (`uuid`) is required and unique.
- **FR-017**: `platform_settings`: exactly one row (`id = 1`); each value within the bounds of data-model.md.
- **FR-018**: Every rule MUST have a stable, readable name, so a rejection says which rule was broken (for example `deals_buyer_not_seller`).

**Indexes**

- **FR-019**: The indexes listed in data-model.md MUST exist, including the partial ones (published lots by creation time, shipped deals by confirmation deadline, issued invoices by expiry time).

**Data definitions in the application**

- **FR-020**: Each of the 13 tables MUST have one data definition (entity) in the application, registered by the feature area that owns it, so later features can read and write it without raw SQL.
- **FR-021**: Money columns MUST round-trip exactly between the database and the application. The application represents an amount as a JavaScript `number` of minor units, exact up to 9,007,199,254,740,991 (`Number.MAX_SAFE_INTEGER`, about 90 trillion in major units). A value outside the safe integer range MUST fail loudly, on read and on write, instead of being rounded. The same rule applies to money sums that a query returns (a sum of `bigint` values comes back as a decimal string, not through the column mapping).
- **FR-022**: The time of the last change (`updated_at`) MUST change on every update of a row that has one.

**Ledger protection by access rights**

- **FR-023**: In this feature, the triggers of FR-010, FR-010a and FR-014 are the only guard against changing or deleting ledger and status history rows. The application keeps one database connection, with no separate role. The restricted role of R4 (only `SELECT` and `INSERT` on the ledger tables) comes with the deploy or security feature.

**Tests and pipeline**

- **FR-024**: Every rule of FR-005 to FR-017 (including FR-006a and FR-010a) MUST have a test against the real database that breaks the rule and checks the rejection, plus a test that a valid row passes. The tests create their own data and do not depend on rows from other tests.
- **FR-025**: A test MUST apply all migrations, revert them, and apply them again (Story 1).
- **FR-026**: The project's standard pipeline MUST fail when the data definitions and the migrations disagree.
- **FR-027**: The project's standard pipeline (`pnpm run ci`) MUST pass, with no lowered thresholds and no skipped tests.

**Documentation**

- **FR-028**: The ERD of the built schema MUST be added to `docs/architecture/` and shown in the README Architecture section, updated to match what was built.
- **FR-029**: The feature 001 design documents MUST be updated to the decisions of this feature (company email, zero or one wallet, the wallet references of FR-006a, account protection, idempotency keys on deals and corrections, the `lot_price_changes` table): `specs/001-marketplace-data-model/data-model.md` (Mermaid ERD, tables, invariants), FR-002 of `specs/001-marketplace-data-model/spec.md`, and the draw.io ERD in `specs/001-marketplace-data-model/erd.drawio.svg` with its identical copy in `docs/system-design/marketplace-v2/erd.drawio.svg`. The Mermaid cardinality between companies and accounts becomes zero-or-one on both sides (`companies |o--o| accounts`). `docs/system-design/marketplace-v1/` does not change.

### Key Entities _(include if feature involves data)_

The entities are those of feature 001, with three changes. Company also has a contact email (billing, notifications), unique across companies regardless of letter case; it is not a login. A company has zero or one wallet account instead of exactly one; the wallet is required before the company sells, buys or receives money. A new entity, Lot price change, records one price of a lot: the old and new price, the time and the actor. The entities are Company, Account, Lot, Lot photo, Lot price change, Deal, Deal status change, Invoice, Ledger transfer, Ledger entry, Top-up, Correction, Platform settings. See the Key Entities section of [feature 001](../001-marketplace-data-model/spec.md) and the tables of [data-model.md](../001-marketplace-data-model/data-model.md).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of the rules in FR-005 to FR-017 (including FR-006a and FR-010a) have at least one test that breaks the rule and sees it rejected, and a traceability list maps each rule to its test.
- **SC-002**: On an empty database, apply, revert and apply again succeed in 100% of runs, and the schema after the second apply is identical to the schema after the first.
- **SC-003**: A data definition change without a matching migration fails the standard pipeline in 100% of cases.
- **SC-004**: A transfer whose entries do not sum to 0, or that has fewer than 2 entries, is never committed: 0 such transfers exist after the tests run.
- **SC-005**: Money amounts round-trip exactly across the whole supported range: the smallest, the largest and a random sample of 1,000 amounts read back identical.
- **SC-006**: A developer of the next feature can write a deal and its invoice from code in under 10 lines, with no raw SQL.

## Assumptions

- The database stays PostgreSQL 17, with the same image pin in `docker-compose.yml` and the test setup. UUID keys use `gen_random_uuid()`; the move to UUIDv7 waits for PostgreSQL 18 (R6).
- The project's existing ORM (TypeORM) and its migration tooling are used; no new dependency is expected.
- Money in the application is a `number` of minor units (Stripe model; FR-021), chosen over `bigint`, strings and a decimal value object. Revisit it if the platform handles 18-decimal assets (switch to `bigint`) or several currencies with fractional splits (add a money value object). The API format of amounts is decided by the first feature with an endpoint.
- `bank_reference` normalization (R12) is enforced by a check rule in the database (the stored value equals its trimmed, upper-case form), in addition to the service normalizing it. Data-model.md says the value is stored normalized but does not list the check; this feature adds it.
- `companies.email` is new in this feature; data-model.md of feature 001 does not have it. It is required, because no company rows exist yet and every company needs a billing contact. The database checks only the basic shape (length, one `@`, no spaces); confirming that the address works is a later onboarding feature.
- Invoice numbers come from one database sequence for all years, so the number part does not restart each year. Data-model.md and R6 do not require a yearly restart.
- Rules that cross tables and are marked "service" in data-model.md (invoice amount equals the deal total, balance equals the sum of entries, allowed status transitions) are not enforced by the database in this feature.
- The ERD in `docs/architecture/` is a copy of the updated feature 001 ERD (FR-029).
- The generator that built the feature 001 draw.io ERD lived in a temporary folder and is gone. The ERD is updated by editing its draw.io model, then re-rendering the SVG picture.
- The idempotency keys only stop a duplicate row. Returning the existing row on a retry, and rejecting a reused key with a different payload, belong to the later service features. A generic API-level key store (Stripe's `Idempotency-Key`) can come with the first API feature, or when the platform calls external systems.
- Database triggers in this feature only reject writes; none writes data. The deferred zero-sum check has no simpler replacement. The append-only and account guards stand in for the restricted database role (FR-023) and can become grants later. Everything that happens (history rows, status transitions, wallet creation, money moves) is service code.
- A wallet is an activation step: a later KYC or onboarding feature can gate it. Creating the wallet, and the "activate your wallet first" errors in purchase, lot and top-up flows, belong to the later service features.
