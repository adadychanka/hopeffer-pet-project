# Implementation Plan: Marketplace Schema

**Branch**: `002-marketplace-schema` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-marketplace-schema/spec.md`

## Summary

Build the marketplace schema of feature 001 (12 tables) plus `lot_price_changes` as TypeORM entities in five feature modules, with five reversible migrations. Every database rule gets a stable name, and an e2e test proves that each rule rejects bad data. Plain constraints (`CHECK`, `UNIQUE`, partial unique indexes, foreign keys) carry almost all rules. Triggers only reject writes, and they do so only where no plain constraint works: the deferred zero-sum check of a ledger transfer, and the append-only and account guards that stand in for the deferred database role. An e2e test asks TypeORM's schema builder for the SQL that would sync the entities to the migrated database and fails if any comes back (the drift check). Money and identity `bigint` columns map to a JS `number` through a transformer that throws outside the safe integer range. The feature also updates the feature 001 design documents and both ERD copies, and adds the ERD to `docs/architecture/`.

## Technical Context

**Language/Version**: TypeScript 6 on Node 24, pure ESM (`module: nodenext`)

**Primary Dependencies**: NestJS 12, `@nestjs/typeorm` 12, TypeORM 1.1.1, `pg` 8. No new dependency.

**Storage**: PostgreSQL 17 (`postgres:17.11-alpine`, same pin in `docker-compose.yml` and `test/setup/global-setup.ts`)

**Testing**: Vitest 4. Unit tests (`*.spec.ts`) for the transformer and the entity metadata. E2E tests (`test/schema/*.e2e-spec.ts`) against the Testcontainers Postgres that `global-setup.ts` migrates.

**Target Platform**: Linux server (container)

**Project Type**: Web service (NestJS backend). This feature adds no endpoint.

**Performance Goals**: None of its own. The zero-sum trigger runs one indexed `SUM` per new entry at commit; transfers have 2 entries.

**Constraints**: `pnpm run ci` passes with 98% coverage; migrations are reversible; `synchronize` stays off; triggers never write data (spec Assumptions).

**Scale/Scope**: 13 tables, about 100 named rules, 5 migrations, 5 feature modules.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                           | Status | How this plan complies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. CI Defines Done                  | Pass   | The drift check and the rule tests run inside `test:e2e`, which `pnpm run ci` already runs. No workflow step is added. No threshold or exclusion changes.                                                                                                                                                                                                                                                                                                                                                                              |
| II. Tests Against Real Dependencies | Pass   | Every rule test runs against the Testcontainers Postgres. No repository is mocked. Each test creates its own companies and rows. The round-trip test uses its own throwaway database, so reverting cannot break parallel tests. Entity files are covered by a unit test that builds the TypeORM metadata (R10). Schema tests are database tests: they open a `DataSource` from `buildTypeOrmOptions()` instead of booting the app, and `drift.e2e-spec.ts` boots `AppModule` to prove every entity is registered (constitution 1.1.0). |
| III. Validated Configuration        | Pass   | No new setting. `buildTypeOrmOptions()` (R3) takes the URL from its caller; the app still reads it through `ConfigService`.                                                                                                                                                                                                                                                                                                                                                                                                            |
| IV. Migrations Own the Schema       | Pass   | Five migrations, each with a complete `down()`. Entities live in `*.entity.ts` files and are registered with `TypeOrmModule.forFeature` in their feature module. The round-trip test proves reversibility.                                                                                                                                                                                                                                                                                                                             |
| V. Structured, Secret-Free Logging  | Pass   | No new log line. Rule violations surface as `QueryFailedError`, which `TypeOrmLogger` already logs without parameters.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| VI. Operable Lifecycle              | Pass   | No new backing service or client. The existing database readiness check covers the tables.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| VII. Pinned Supply Chain            | Pass   | No new dependency or image.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tech constraints                    | Pass   | `.js` import extensions; feature modules inject the existing global `DataSource`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Re-check after Phase 1: Pass. The design adds no dependency, no setting and no workflow step. Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-marketplace-schema/
├── plan.md                         # This file
├── research.md                     # Phase 0: decisions R1–R14
├── data-model.md                   # Phase 1: entity mapping, deltas against feature 001, naming
├── quickstart.md                   # Phase 1: validation guide
├── contracts/
│   └── schema-rules.md             # Phase 1: every named rule, its requirement and its test (SC-001)
├── checklists/requirements.md
└── tasks.md                        # Phase 2 (/speckit-tasks)
```

### Source code

```text
src/
├── companies/
│   ├── company.entity.ts
│   └── companies.module.ts
├── catalog/
│   ├── lot.entity.ts
│   ├── lot-photo.entity.ts
│   ├── lot-price-change.entity.ts
│   └── catalog.module.ts
├── deals/
│   ├── deal.entity.ts
│   ├── deal-status-change.entity.ts
│   ├── invoice.entity.ts
│   └── deals.module.ts
├── ledger/
│   ├── account.entity.ts
│   ├── ledger-transfer.entity.ts
│   ├── ledger-entry.entity.ts
│   ├── top-up.entity.ts
│   ├── correction.entity.ts
│   └── ledger.module.ts
├── platform-settings/
│   ├── platform-settings.entity.ts
│   └── platform-settings.module.ts
├── database/
│   ├── entities.spec.ts            # globs *.entity.ts, builds metadata, checks tables and rule names (R10)
│   ├── typeorm-options.ts          # buildTypeOrmOptions(url): options shared by every DataSource (R3)
│   ├── typeorm-options.spec.ts
│   ├── actor-types.ts              # ACTOR_TYPES shared by deal_status_changes and ledger_transfers
│   ├── sql-list.ts                 # renders a constant value list for CHECK (... IN (...)) rules
│   ├── safe-bigint.ts              # transformer and parser for bigint columns and sums (R6)
│   ├── safe-bigint.spec.ts
│   ├── data-source.ts              # CLI: starts from buildTypeOrmOptions()
│   ├── database.module.ts          # starts from buildTypeOrmOptions()
│   └── migrations/
│       ├── <ts>-CreateCompaniesAndAccounts.ts
│       ├── <ts>-CreatePlatformSettings.ts
│       ├── <ts>-CreateCatalog.ts
│       ├── <ts>-CreateDeals.ts
│       └── <ts>-CreateLedger.ts
└── app.module.ts                   # imports the five feature modules

test/
├── setup/global-setup.ts           # starts from buildTypeOrmOptions()
├── setup/migrations.ts             # loadMigrations(), shared with the round-trip test
└── schema/
    ├── helpers.ts                  # DataSource for tests, fixtures, expectRule()
    ├── migrations.e2e-spec.ts      # Story 1: apply, revert, apply on a throwaway database
    ├── catalog-deals.e2e-spec.ts   # Story 2
    ├── money.e2e-spec.ts           # Story 3
    ├── entities.e2e-spec.ts        # Story 4: round-trip of every table and of money limits
    └── drift.e2e-spec.ts           # Story 5: schema drift, and AppModule registers every entity

docs/architecture/erd.drawio.svg    # FR-028: copy of the updated ERD
specs/001-marketplace-data-model/   # FR-029: data-model.md, spec.md FR-002, erd.drawio.svg
docs/system-design/marketplace-v2/erd.drawio.svg   # FR-029: identical copy
README.md                           # FR-028: ERD in the Architecture section
package.json                        # `migration:check` script for local use (R11)
AGENTS.md                           # trigger rule, shared options, drift and registration checks
src/spike/                          # temporary (T009), deleted after the spike
```

**Structure Decision**: Feature folders under `src/`, one per area of the data model (R1). Schema tests are e2e tests in `test/schema/`, because they need the migrated container. Shared database helpers stay in `src/database/`.

## Implementation Outline (for /speckit-tasks)

1. Shared database pieces: `typeorm-options.ts` and `safe-bigint.ts` with their unit tests, `buildTypeOrmOptions()` used by `DatabaseModule`, `data-source.ts` and `global-setup.ts`. Feature 001's `data-model.md` and FR-002 are updated first, so the entity tasks read one source.
2. A spike that proves the risky TypeORM mappings before all tables are written (R13): a composite foreign key to a non-primary unique pair, a foreign key to `accounts.company_id`, a `synchronize: false` expression index, a deferrable unique, a function default. Pass condition: the drift check returns no SQL.
3. One migration per area, in foreign key order (R4): entities first, `migration:generate`, then the hand-written SQL (triggers, functions, seeds, the expression index) at the end of `up()` and the start of `down()`.
4. Test helpers, then one test per rule of `contracts/schema-rules.md`, story by story.
5. The round-trip, drift and entity round-trip tests.
6. Documentation: feature 001 documents and both ERD copies, `docs/architecture/erd.drawio.svg`, README, AGENTS.md.
7. `pnpm run ci`.

## Complexity Tracking

No violations.
