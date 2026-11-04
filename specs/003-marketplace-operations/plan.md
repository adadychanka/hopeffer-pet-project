# Implementation Plan: Marketplace Operations

**Branch**: `003-marketplace-operations` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-marketplace-operations/spec.md`

## Summary

Add the first three business operations as HTTP endpoints on the schema of feature 002: `POST /top-ups` (the operator records a bank notification; a named, covered invoice is paid in the same step), `POST /lots/{lotId}/price-changes` (seller or operator), and `POST /deals` (buy, pay later or at once, idempotent by `Idempotency-Key`). Each operation is one `READ COMMITTED` transaction that locks every account it may touch up front in id order, then the invoice, then the lot. A conditional `UPDATE` reserves stock and reads the price in one row lock. Shared posting functions (`lockAccounts()`, `LockedAccounts.post()`) write every transfer, its entries and the balances. Input goes through zod (already a dependency); errors are RFC 9457 problem details with a stable code, and the database rule names that races can still hit map to the same codes. The caller states the actor in three trusted headers until the security feature exists. Coverage moves to one Vitest run over unit and e2e projects, because the services are SQL tested against real Postgres. No schema change.

## Technical Context

**Language/Version**: TypeScript 6 on Node 24, pure ESM (`module: nodenext`)

**Primary Dependencies**: NestJS 12 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`), `@nestjs/typeorm` 12, TypeORM 1.1.1, `pg` 8, zod 4. No new dependency.

**Storage**: PostgreSQL 17, schema of feature 002, unchanged.

**Testing**: Vitest 4.1. Unit tests (`*.spec.ts`) for the pure parts. E2E tests (`test/operations/*.e2e-spec.ts`) boot `AppModule` once per file and call the API with supertest against the Testcontainers Postgres. Coverage over both (R10).

**Target Platform**: Linux server (container)

**Project Type**: Web service (NestJS backend). First business endpoints.

**Performance Goals**: Each operation answers within 1 second under normal load (spec Assumptions). Each runs a handful of indexed statements in one transaction.

**Constraints**: Stock never below 0 and balances never below 0 under concurrency (SC-001, SC-002); ledger invariants after every operation (SC-003); `pnpm run ci` passes at 98% coverage; no mocked repositories.

**Scale/Scope**: 3 endpoints, 5 services, 1 new module, about 17 error codes. Platform accounts (escrow, bank clearing) are serialization points; accepted at this scale (R2).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                           | Status | How this plan complies                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. CI Defines Done                  | Pass   | `ci` keeps every check. `test:cov` now runs unit and e2e projects under coverage, so `ci` runs `test:cov` instead of `test:cov && test:e2e`; the e2e tests still run once (R10). Thresholds and exclusions do not change. No workflow step is added.                                                                    |
| II. Tests Against Real Dependencies | Pass   | Services are tested only through the booted `AppModule` against the Testcontainers Postgres, once per file. No repository or `EntityManager` is mocked. Each test creates its own companies, wallets and lots. Tests that touch the shared platform accounts check only their own deltas and the global zero sum (R11). |
| III. Validated Configuration        | Pass   | No new setting. The limits and windows come from `platform_settings`, which is data, not configuration.                                                                                                                                                                                                                 |
| IV. Migrations Own the Schema       | Pass   | No schema change; `migration:check` stays clean.                                                                                                                                                                                                                                                                        |
| V. Structured, Secret-Free Logging  | Pass   | One `info` line per operation with ids and amounts as fields; no bank reference, actor reference or body (R12). Unmapped errors go under `err`.                                                                                                                                                                         |
| VI. Operable Lifecycle              | Pass   | No new backing service or client. Requests in flight finish during the existing shutdown drain; each operation is one transaction, so a cut-off request rolls back whole.                                                                                                                                               |
| VII. Pinned Supply Chain            | Pass   | No new dependency, image or action.                                                                                                                                                                                                                                                                                     |
| Tech constraints                    | Pass   | `.js` import extensions; services inject the global `DataSource`; `@Injectable()` / `@Controller()` over constructors get the `v8 ignore` wrapper of `src/app.controller.ts`.                                                                                                                                           |

Re-check after Phase 1: Pass. The design adds no dependency, no setting, no table and no workflow step. Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-marketplace-operations/
├── plan.md                 # This file
├── research.md             # Phase 0: decisions R1–R12
├── data-model.md           # Phase 1: rows written per operation, state changes, service checks
├── quickstart.md           # Phase 1: validation guide
├── contracts/
│   └── http-api.md         # Phase 1: endpoints, actor headers, error codes
├── checklists/requirements.md
└── tasks.md                # Phase 2 (/speckit-tasks)
```

### Source code

```text
src/
├── http/                               # shared HTTP pieces, no business logic
│   ├── actor.ts                        # ActorContext decorator, header schema, role check (R5)
│   ├── actor.spec.ts
│   ├── zod-validation.pipe.ts          # body and header validation (R6)
│   ├── zod-validation.pipe.spec.ts
│   ├── domain-error.ts                 # DomainError(code), code → status and title (R7)
│   ├── constraint-errors.ts            # database rule name → code (R7)
│   ├── problem-details.filter.ts       # APP_FILTER: RFC 9457 responses
│   ├── problem-details.filter.spec.ts
│   └── http.module.ts                  # provides the filter as APP_FILTER
├── ledger/
│   ├── posting.ts                      # lockAccounts(), platformAccountIds() (R3)
│   ├── locked-accounts.ts              # apply() arithmetic (pure), post() writes
│   └── locked-accounts.spec.ts
├── deals/
│   ├── invoice-payment.service.ts      # pay an issued invoice from the buyer wallet
│   ├── purchases.service.ts            # Buy a lot
│   ├── purchase.schema.ts              # body and Idempotency-Key schemas
│   ├── deals.controller.ts             # POST /deals
│   └── deals.module.ts                 # + exports InvoicePaymentService
├── catalog/
│   ├── lot-pricing.service.ts          # Update the price of a lot
│   ├── price-change.schema.ts
│   ├── lots.controller.ts              # POST /lots/:lotId/price-changes
│   └── catalog.module.ts               # + providers and controller
├── wallets/                            # new: wallet operations (R1)
│   ├── top-ups.service.ts              # Top up wallet
│   ├── top-up.schema.ts                # includes normalizeBankReference()
│   ├── top-up.schema.spec.ts
│   ├── top-ups.controller.ts           # POST /top-ups
│   └── wallets.module.ts               # imports DealsModule
└── app.module.ts                       # + HttpModule, WalletsModule

test/
├── operations/
│   ├── helpers.ts                      # booted app, actor headers, ledger invariant check
│   ├── top-up.e2e-spec.ts              # User Story 2
│   ├── price-change.e2e-spec.ts        # User Story 3
│   └── purchase.e2e-spec.ts            # User Story 1, concurrency (SC-001, SC-002, SC-005)
└── schema/helpers.ts                   # reused fixtures (companies, wallets, lots, deals, invoices)

vitest.config.ts                        # unit and e2e projects, coverage over both (R10)
vitest.config.e2e.ts                    # removed; its settings move into the e2e project
package.json                            # test, test:e2e, test:cov, ci scripts (R10)
AGENTS.md                               # coverage over e2e, actor headers warning, error codes, lock order
README.md                               # the three endpoints and the trusted-headers warning
```

**Structure Decision**: Each operation lives in the feature folder of the data it changes (R1); `wallets/` exists because the top-up spans the ledger and deals. Shared HTTP plumbing goes in `src/http/`, separate from business code. E2E tests of the operations go in `test/operations/`, next to the existing `test/schema/`.

## Implementation Outline (for /speckit-tasks)

1. **Spike: coverage over e2e** (R10). Merge the two Vitest configs into projects, run `test:cov`, and confirm that code reached only from an e2e test counts. Pass condition: a throwaway service called only from an e2e test shows as covered. Then update the scripts and AGENTS.md.
2. **HTTP plumbing**: `DomainError`, error tables, problem details filter, zod pipe, `ActorContext`, `HttpModule`, with unit tests. The filter catches only `DomainError` and `QueryFailedError`, so Nest's own responses (terminus `/ready`, unknown routes) keep their bodies.
3. **Ledger posting**: `LockedAccounts` (unit-tested arithmetic) and the posting functions in `src/ledger/posting.ts`.
4. **User Story 1, Buy a lot**: `InvoicePaymentService`, `PurchasesService`, `DealsController`, e2e tests for every scenario, edge case and error code, then the concurrency tests.
5. **User Story 2, Top up wallet**: `WalletsModule`, `TopUpsService` (reuses `InvoicePaymentService`), e2e tests including the invoice paths and the duplicate reference race.
6. **User Story 3, Update the price**: `LotPricingService`, `LotsController`, e2e tests including the concurrent change and the hidden-lot visibility rule.
7. **Docs**: AGENTS.md (coverage, lock order, error codes, trusted headers), README endpoints. Spec FR-021 is already narrowed (R9).
8. `pnpm run ci`.

## Complexity Tracking

No violations.
