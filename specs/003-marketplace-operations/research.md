# Research: Marketplace Operations

Decisions for the three operations of [spec.md](./spec.md), built on the schema of [feature 002](../002-marketplace-schema/data-model.md) and the flows of [feature 001](../001-marketplace-data-model/data-model.md#flows-which-rows-each-step-writes). Facts about the libraries come from the installed versions: NestJS 12, TypeORM 1.1.1, zod 4, Vitest 4.1.

## R1. Services sit in the existing feature modules, plus one new `wallets` module

- **Decision**:

  | Module                | New providers                                                             | Operation                        |
  | --------------------- | ------------------------------------------------------------------------- | -------------------------------- |
  | `LedgerModule`        | none: posting is plain functions in `src/ledger/posting.ts` (R3)          | none; posts transfers for others |
  | `DealsModule`         | `InvoicePaymentService` (exported), `PurchasesService`, `DealsController` | Buy a lot                        |
  | `CatalogModule`       | `LotPricingService`, `LotsController`                                     | Update the price of a lot        |
  | `WalletsModule` (new) | `TopUpsService`, `TopUpsController`                                       | Top up wallet                    |

  Imports: `WalletsModule` → `DealsModule`. `DealsModule` and `CatalogModule` import no other feature module; the posting functions are plain imports.

- **Rationale**: A top-up can pay an invoice (FR-010a), so the top-up needs `InvoicePaymentService` from deals, and invoice payment needs ledger posting. If the top-up lived in `LedgerModule`, `LedgerModule` and `DealsModule` would import each other. A `WalletsModule` that orchestrates both keeps the graph acyclic. It is also where later wallet operations go (statement, corrections). The `top_ups` entity stays registered in `LedgerModule`: the service writes through the transaction's `EntityManager`, which needs no repository injection.
- **Alternatives considered**: `forwardRef()` between `LedgerModule` and `DealsModule`: works, but Nest documents it as a last resort, and the cycle would grow with every money operation. One `MarketplaceModule` for all three operations: no cycle, but it undoes the per-area split of feature 002 (R1 there).

## R2. One transaction per operation, row locks in a fixed order

- **Decision**: Each operation runs in one `READ COMMITTED` transaction (`dataSource.transaction()`). Locks are taken in one fixed order, so two operations never wait on each other in a circle:
  1. **Accounts**: every account the operation may touch, in one statement, `SELECT … FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE`. Rows are locked in the sort order, because PostgreSQL's `LockRows` step runs above the sort.
  2. **Invoice** (top-up that names one): `SELECT … FOR UPDATE` on the invoice and its deal.
  3. **Lot**: the conditional `UPDATE lots` (purchase) or `SELECT … FOR UPDATE` (price change).

  | Operation             | Accounts locked                       | Then                        |
  | --------------------- | ------------------------------------- | --------------------------- |
  | Buy, pay later        | buyer wallet                          | lot (conditional `UPDATE`)  |
  | Buy, pay at once      | buyer wallet, escrow                  | lot (conditional `UPDATE`)  |
  | Top up, no invoice    | company wallet, bank clearing         | none                        |
  | Top up, names invoice | company wallet, bank clearing, escrow | invoice and its deal        |
  | Change price          | none                                  | lot (`SELECT … FOR UPDATE`) |

- **Rationale**:
  - The buyer wallet lock serializes all purchases of one buyer. That makes the unpaid limit and the prepay-only count exact (FR-019) and makes concurrent retries with the same idempotency key see the first deal (FR-021): the second request reads after the first commits.
  - The conditional `UPDATE lots SET stock_available = stock_available - $q … WHERE stock_available >= $q AND status = 'published' RETURNING unit_price_minor, seller_company_id` reserves stock and reads the price in one row lock. A concurrent price change waits on the same row, so a deal gets the old or the new price, never a mix (spec edge case). No oversell is possible (SC-001); `lots_stock_not_negative` is the backstop.
  - Locking an account before changing its balance keeps `balance_after_minor` exact and stops two payments from spending one balance (SC-002). `accounts_balance_not_negative` is the backstop.
  - Locking the whole account set up front, sorted, is the standard deadlock-avoidance rule for ledgers (lock ordering). It costs one escrow lock for a top-up that names an invoice it then does not pay; that is cheap.
- **Trade-off (hot accounts)**: every top-up locks the bank clearing row, and every payment locks the escrow row, so those operations run one at a time platform-wide. That is fine at this project's scale (one operator, manual top-ups). Payment platforms at scale avoid it by not keeping a running balance on platform accounts (derive it from entries) or by splitting a hot account into sub-accounts. Both would change the schema of feature 002 and are left for later.
- **Alternatives considered**: `SERIALIZABLE` with retries: correct, but every operation needs a retry loop, and the conflicts are already known and lockable. Optimistic locking with a version column: needs a schema change and retries on the hottest rows. Advisory locks per buyer: work, but the wallet row is already the natural lock.

## R3. Shared posting: plain functions over locked accounts

- **Decision**: `src/ledger/posting.ts` exports `lockAccounts(manager, accountIds)`, which runs the lock statement of R2 and returns a `LockedAccounts` object that holds each locked balance, and `platformAccountIds(manager)`. `LockedAccounts.post(manager, { type, source, actor, legs })` checks that the legs sum to 0 and every account is locked, computes the new balances, rejects a wallet or escrow balance below 0 with `insufficient_balance`, updates `accounts.balance_minor`, inserts the transfer with `entry_count = legs.length`, and inserts one entry per leg with `balance_after_minor`. Balances stay in memory between transfers of the same transaction, so a top-up followed by an invoice payment writes the right `balance_after_minor` on both.
- **Rationale**: Every money operation of features 001 and later (payout, refund, correction) has the same shape. One implementation keeps the ledger invariants of FR-005 in one place, and the deferred trigger `ledger_transfers_balanced` checks it again at commit. Plain functions, not a Nest provider: posting has no dependencies (it takes the transaction's `EntityManager`), so DI would add module wiring and an untestable decorator branch for nothing (chosen with the user on 2026-10-23).
- **Alternatives considered**: Each service writes its own entries: four copies of the balance arithmetic. A database function that posts a transfer: moves money logic into SQL, against the project rule that triggers and functions only reject writes.

## R4. HTTP API shape

- **Decision**:

  | Operation     | Request                            | Success                      |
  | ------------- | ---------------------------------- | ---------------------------- |
  | Top up wallet | `POST /top-ups`                    | `201` with the top-up        |
  | Change price  | `POST /lots/{lotId}/price-changes` | `201` with the price change  |
  | Buy a lot     | `POST /deals` + `Idempotency-Key`  | `201` new deal, `200` replay |

  Amounts are JSON integers in minor units, in fields that end in `Minor`, as in Stripe's API. Full contract: [contracts/http-api.md](./contracts/http-api.md).

- **Rationale**:
  - A price change creates an append-only history row and is not idempotent (the same price twice is rejected, FR-013). `POST` to a `price-changes` collection says that. `PUT /lots/{id}/price` would promise that a repeated request is harmless, and the second one would fail.
  - `Idempotency-Key` is the header name of the IETF draft (draft-ietf-httpapi-idempotency-key-header) and of Stripe. A replay answers `200` with the header `Idempotent-Replayed: true` (Stripe's name) and the deal's current state.
  - A top-up needs no idempotency key: the bank reference is its natural key (FR-007). A second request with the same reference is a duplicate notification, and the operator must see it (`409`), not a silent replay.
- **Alternatives considered**: `PATCH /lots/{id}` with `unitPriceMinor`: the common CRUD form, but it hides that a price change is an event with its own record and actor. Money as decimal strings (`"10.50"`): avoids float doubts, but every client must convert, and the schema stores minor units anyway.

## R5. Who acts: trusted headers until the security feature

- **Decision**: Every request of this feature carries:

  | Header         | Values                    | Meaning                                                             |
  | -------------- | ------------------------- | ------------------------------------------------------------------- |
  | `X-Actor-Role` | `operator` or `company`   | Who acts: a platform operator, or a person acting for a company.    |
  | `X-Actor-Ref`  | 1–200 characters          | The opaque person reference stored in `actor_ref` / `operator_ref`. |
  | `X-Company-Id` | uuid, only with `company` | The company the person acts for.                                    |

  A `ActorContext` parameter decorator parses them with zod. Each endpoint states the roles it accepts: top-up `operator`; price change `company` (as `seller`) or `operator`; purchase `company` (as `buyer`).

- **Rationale**: The spec keeps authentication out of scope and has the caller state the actor (FR-002). The three headers carry exactly what a session will later provide (a person, an operator flag, a company membership), so the security feature replaces the decorator's source and nothing else. An explicit role header means a missing header fails with `400`, instead of turning the caller into an operator by default.
- **Security note**: these headers are trusted as sent. Anyone who can reach the API can act as any company or as an operator. The service must not be exposed outside a trusted network until the security feature replaces them. AGENTS.md and the README get a line saying so.
- **Precedent**: Who acts is request context, not payload, as with `Authorization`. Stripe Connect acts for another account with the `Stripe-Account` header.
- **Alternatives considered** (reviewed with the user on 2026-10-23; headers kept):
  - Actor fields in the request body (`buyerCompanyId`, `operatorRef`): the simplest and most visible, but when the security feature arrives the fields must be removed (a breaking API change) or ignored (and stay spoofable inputs). Each body schema repeats them.
  - The company in the path (`/companies/{companyId}/deals`, like GitHub's `/orgs/{org}/…`): shows the scope in the URL, but the person reference still needs another place, and the operator's top-up has no company to put in the path.
  - Minimal real authentication now (API keys or a development JWT): cannot be spoofed, but needs a users or keys table, and the spec keeps security out of scope.
  - Two headers, with operator meaning "no `X-Company-Id`": one header fewer, but a forgotten company header would silently make the caller an operator.
  - A fake bearer token: looks like security without being any.

## R6. Input validation with zod, already a dependency

- **Decision**: A `ZodValidationPipe` validates bodies and headers against zod schemas (`z.strictObject`, unknown fields rejected). Rules:
  - Amounts and prices: `z.int().positive().max(Number.MAX_SAFE_INTEGER)`. `JSON.parse` turns any integer above 2^53 into a number above `MAX_SAFE_INTEGER`, so a too-large amount is always rejected, never rounded (FR-004). Fractions fail `int()`.
  - Quantity: integer 1 to 2,147,483,647 (the `integer` column).
  - Bank reference: all whitespace removed and upper-cased first (FR-007), then 1–140 characters of the SEPA reference character set that `top_ups_bank_reference_normalized` allows. 140 is the SEPA limit for unstructured remittance information.
  - Transfer date: a real calendar date `YYYY-MM-DD`, at most 1 day after the server's UTC date (a bank in a time zone ahead of UTC can already be on the next day).
  - Ids and the idempotency key: uuid.
- **Rationale**: zod 4 already validates the environment (`src/config/env.ts`), so one validation library serves the whole app. Constitution: a new dependency needs a reason, and there is none.
- **Alternatives considered**: `class-validator` with Nest's `ValidationPipe`: the Nest default, but two new dependencies and a second validation style next to zod.

## R7. Errors: RFC 9457 problem details with a stable `code`

- **Decision**: A global exception filter (registered as `APP_FILTER`, so tests that boot `AppModule` get it too) answers every error as `application/problem+json`: `type`, `title`, `status`, `detail`, plus a stable `code` (FR-003) and, for validation, `errors` with the field paths. Services throw a `DomainError(code)`; one table maps each code to its HTTP status and title ([contracts/http-api.md](./contracts/http-api.md#error-codes)). A second table maps the database rule names that a race can still hit (`QueryFailedError.driverError.constraint`) to the same codes, as feature 002 planned. An unmapped `QueryFailedError` is a `500`, logged with `err`. The filter also maps Nest's `BadRequestException` from the JSON body parser to `validation_failed` and `PayloadTooLargeException` to `payload_too_large`. Other Nest exceptions (terminus `/ready`, unknown routes) keep Nest's bodies.
- **Status rule**: `400` malformed request; `403` the actor may not act on this resource; `404` the resource in the path does not exist (or is hidden from this actor); `409` duplicate or state conflict (`bank_reference_already_recorded`, `price_unchanged`); `422` the request is well formed but a business rule rejects it (balance, stock, limits, references in the body).
- **Rationale**: RFC 9457 is the current standard for HTTP API errors; clients branch on `code`, people read `detail`. Mapping both the service checks and the database rules to one code means a race reports the same error as the normal path (FR-003).
- **Alternatives considered**: Nest's default `{ statusCode, message, error }`: no stable code. A custom envelope `{ error: { code, message } }`: works, but reinvents RFC 9457.

## R8. Time comes from the database clock

- **Decision**: All times of one operation use the transaction's `now()`: `issued_at`, `due_at = now() + make_interval(days => payment_window_days)`, `expires_at = due_at + make_interval(days => grace_period_days)`, `paid_at`, `changed_at`, `recorded_at`. The prepay-only check counts the buyer's `expired` deals whose invoice `expires_at > now() - make_interval(days => expiry_lookback_days)`.
- **Rationale**: `now()` is fixed for the whole transaction, so the deal, its status changes, the invoice and the ledger rows share one timestamp, as the column defaults already do. One clock (the database) avoids skew between app instances. Settings are read inside the transaction, so a purchase uses one consistent set (FR-024 of feature 001: changes apply to new deals).
- **Alternatives considered**: Times from `Date.now()` in the service: easier to fake in tests, but a second clock next to the column defaults.

## R9. Idempotent purchase

- **Decision**: After the buyer wallet is locked (R2), the service looks up `deals` by `(buyer_company_id, idempotency_key)`. Found with the same `lotId` and `quantity`: replay, `200`, current state, nothing written. Found with a different `lotId` or `quantity`: `422 idempotency_key_reused`. Not found: create. A `deals_buyer_idempotency_key_key` violation (impossible behind the wallet lock, kept as a backstop) is answered as a replay.
- **Payment choice**: the deal row does not record whether the buyer asked to pay at once, so a reused key with only a different `payNow` is answered as a replay. The spec's FR-021 is narrowed to lot and quantity. Storing a request fingerprint, as Stripe does, needs a schema change; it is not worth one for a flag whose effect is visible in the replayed state.
- **Unknown key format**: `Idempotency-Key` must be a uuid (the column type). A missing key is `400`.
- **Alternatives considered**: An idempotency table with stored responses (Stripe's full model): generic for every endpoint, but a new table and expiry job for one endpoint that already has a unique key on its row.

## R10. Coverage includes the e2e tests

- **Decision**: One Vitest config with two projects, `unit` (`*.spec.ts`) and `e2e` (`*.e2e-spec.ts`, with the Testcontainers global setup). `test:cov` builds, then runs both projects with coverage, and the 98% thresholds apply to the merged result. `test` runs `--project unit`, `test:e2e` builds and runs `--project e2e`. The `ci` script runs `test:cov` in place of `test:cov && test:e2e`, so the e2e tests still run, once.
- **Rationale**: The operations are mostly SQL in transactions. Constitution II forbids mocked repositories for database code, and the unit run has no database, so a unit-only coverage run would leave the services below 98% with no allowed way to raise it. Running the real-Postgres tests under coverage measures what they prove. No threshold or exclusion changes, and every check still runs (Constitution I).
- **Risk and check**: v8 coverage must see code that runs in the e2e workers, including code loaded by `AppModule`. A spike task proves it before the services are written; the child process of `shutdown.e2e-spec.ts` (`dist/main.js`) is not measured, which is fine, because `main.ts` is excluded already.
- **Alternatives considered**: Mock `EntityManager` in unit tests: forbidden by Constitution II, and it would test the mocks. Exclude services from coverage: weakens a check. Keep two configs and merge reports with `vitest --merge-reports`: two runs and a merge step for what one projects config does.

## R11. Tests

- **Decision**:
  - E2E, one file per operation: `test/operations/top-up.e2e-spec.ts`, `price-change.e2e-spec.ts`, `purchase.e2e-spec.ts`. Each boots `AppModule` once (`beforeAll`) and calls the HTTP API with supertest, so the routes, headers, validation, error filter and transactions are tested together. Fixtures reuse `test/schema/helpers.ts` (companies, wallets, lots, deals, invoices with random unique values).
  - Concurrency tests (SC-001, SC-002, SC-005, two top-ups with one reference) fire parallel requests with `Promise.all` against the booted app. The pool size (`DB_POOL_SIZE`) must allow 10 parallel transactions in tests.
  - Invariant check (SC-003): a helper runs the three reconciliation queries of feature 001 after each money test, scoped to the test's own accounts and deals, plus the platform-wide sum, which all tests keep at 0.
  - Unit tests for the pure parts: bank reference normalization, zod schemas, error code tables, the problem details filter, `ActorContext` parsing, `LockedAccounts` arithmetic.
- **Rationale**: Constitution II: database code is tested against the real container, app behaviour through the booted `AppModule`, once per file.

## R12. Logging

- **Decision**: One `info` line per successful operation, with ids and amounts as fields and no reference text: `Top-up recorded` (`topUpId`, `companyId`, `amountMinor`, `paidInvoiceId`), `Lot price changed` (`lotId`, `oldPriceMinor`, `newPriceMinor`), `Deal created` (`dealId`, `lotId`, `buyerCompanyId`, `totalMinor`, `paid`). Rejections are not logged by the services: pino-http already logs each `4xx` at `warn`. An unmapped database error is logged at `error` with `err`.
- **Rationale**: Money events need an operational trace; Constitution V rules out the bank reference and request bodies. The actor reference is a person reference and stays out of logs too; the ledger stores it.
