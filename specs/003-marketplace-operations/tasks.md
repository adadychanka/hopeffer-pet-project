---
description: 'Task list for the marketplace operations feature'
---

# Tasks: Marketplace Operations

**Input**: Design documents from `specs/003-marketplace-operations/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/http-api.md](./contracts/http-api.md), [quickstart.md](./quickstart.md)

**Tests**: Required. The constitution (Principle I and II) makes tests part of done: 98% coverage, database code tested against the real Postgres container, app behaviour through the booted `AppModule`. Within each story, write the e2e tests first and see them fail.

**Organization**: One phase per user story, in the spec's priority order. Buy a lot (US1) and Top up wallet (US2) are both P1. US1 comes first because it creates the deals and invoices that a top-up pays. Both stories depend only on Phase 2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: The user story the task belongs to (US1, US2, US3)

## Rules for every task

- ESM: relative imports end in `.js`. Vitest globals are off: import `describe`, `it`, `expect`, `vi` from `vitest`.
- Wrap an `@Injectable()` or `@Controller()` decorator that sits over a constructor with parameters in `/* v8 ignore start -- TS __decorate helper branch, not app logic */` … `/* v8 ignore stop */`, as `src/app.controller.ts` does.
- Database code is never tested with mocks (Constitution II). Pure code (schemas, tables, arithmetic, the filter) gets unit tests next to it.
- Every test creates its own companies, wallets and lots with the fixtures in `test/schema/helpers.ts`. E2E files run in parallel against one database, and the escrow and bank clearing rows are shared. Never assert a platform account's balance or a global sum. Assert the test's own ledger entries and its own wallets instead.
- Log with `new Logger(Class.name)`, data as fields, never the bank reference, the actor reference or a body (research R12).
- Run `pnpm exec prettier --write` on root config files you change (`vitest.config.ts`, `package.json`, `*.md`).

---

## Phase 1: Setup (coverage over unit and e2e tests)

**Purpose**: Make the e2e tests count toward coverage (research R10). The services are SQL tested against Postgres, so without this the 98% threshold cannot pass.

- [x] T001 Merge `vitest.config.e2e.ts` into `vitest.config.ts` as two inline projects with `test.projects`. Project `unit`: `extends: true`, `include: ['**/*.spec.ts']`. Project `e2e`: `extends: true`, `include: ['**/*.e2e-spec.ts']`, `globalSetup: ['./test/setup/global-setup.ts']`, `setupFiles: ['./test/setup/env.ts']`. Keep `plugins: [tsconfigPaths()]`, `exclude: [...configDefaults.exclude, 'experiments/**']`, and the whole `coverage` block (provider, reporters, `include`, every `exclude` with its comment, thresholds 98) at the root. Delete `vitest.config.e2e.ts`.
- [x] T002 Update the scripts in `package.json`: `test` = `vitest run --project unit`; `test:watch` = `vitest --project unit`; `test:debug` = `vitest --project unit --inspect-brk --no-file-parallelism`; `test:e2e` = `pnpm run build && vitest run --project e2e`; `test:cov` = `pnpm run build && vitest run --coverage` (both projects); `ci` ends with `… && pnpm run build && pnpm run test:cov`, without the separate `pnpm run test:e2e`. Nothing else in `ci` changes.
- [x] T003 Spike: prove that code reached only from an e2e test counts. Add a temporary `src/spike/coverage-probe.ts` exporting `probe(): string` and a temporary `test/spike.e2e-spec.ts` that calls it. Run `pnpm exec vitest run --coverage --project e2e` and check that the text report shows `coverage-probe.ts` at 100%. Then run `pnpm run test:cov` and check it passes. Delete both files. **If the probe is not covered, stop and report**: the plan depends on it.
- [x] T004 Update `AGENTS.md`: the commands block (`test:e2e` and `test:cov` now as in T002, the single-file example `pnpm exec vitest run --project unit src/s3/s3.service.spec.ts`), the "Definition of done" list of what `ci` runs, and the architecture line on e2e tests (`vitest.config.e2e.ts` becomes the `e2e` project of `vitest.config.ts`). Add one sentence: coverage is measured over both projects, because database code is tested only against the real container. Update the `vitest.config.e2e.ts` mention in `specs/002-marketplace-schema/quickstart.md` the same way.

**Checkpoint**: `pnpm run test:cov` runs unit and e2e tests and passes at 98%.

---

## Phase 2: Foundational (HTTP plumbing, ledger posting, invoice payment)

**Purpose**: The pieces every operation uses. No user story starts before this phase is done.

### HTTP plumbing (`src/http/`, research R5–R7)

- [x] T005 [P] Create `src/http/domain-error.ts`: `ERROR_CODES`, a constant table from each code of [contracts/http-api.md, Error codes](./contracts/http-api.md#error-codes) to `{ status, title }` (`validation_failed` 400, `forbidden_role` 403, `payload_too_large` 413, `not_lot_seller` 403, `lot_not_found` 404, `bank_reference_already_recorded` 409, `price_unchanged` 409, `company_not_found` 422, `wallet_not_activated` 422, `invoice_not_found` 422, `idempotency_key_reused` 422, `own_lot` 422, `insufficient_stock` 422, `amount_too_large` 422, `unpaid_deal_limit_reached` 422, `prepay_only` 422, `insufficient_balance` 422, `internal_error` 500); type `ErrorCode`; class `DomainError extends Error` with `code`, optional `detail` and optional `errors: { path: string; message: string }[]`. Unit test `src/http/domain-error.spec.ts`: every code has a status and a title.
- [x] T006 [P] Create `src/http/constraint-errors.ts`: `CONSTRAINT_CODES`, the database rule names of the contract's last column mapped to codes (`top_ups_bank_reference_key` → `bank_reference_already_recorded`, `lot_price_changes_price_changed` → `price_unchanged`, `top_ups_company_id_fkey` and `deals_buyer_company_id_fkey` → `wallet_not_activated`, `top_ups_invoice_id_fkey` → `invoice_not_found`, `deals_buyer_not_seller` → `own_lot`, `lots_stock_not_negative` → `insufficient_stock`, `accounts_balance_not_negative` → `insufficient_balance`, `deals_lot_seller_fkey` → `lot_not_found`), and `domainErrorFrom(error: unknown): DomainError | undefined`, which reads `driverError.constraint` of a `QueryFailedError`. Unit test `src/http/constraint-errors.spec.ts` with constructed `QueryFailedError` objects (no database): a mapped rule, an unmapped rule, a non-database error.
- [x] T007 Create `src/http/problem-details.filter.ts`: `@Catch(DomainError, QueryFailedError, BadRequestException, PayloadTooLargeException)`. A `BadRequestException` (the JSON body parser on malformed JSON) answers `400 validation_failed` with `errors: [{ path: 'body', message: 'Malformed JSON' }]`. A `PayloadTooLargeException` answers `413 payload_too_large`. A `DomainError`, or a `QueryFailedError` that `domainErrorFrom()` maps, answers its status with `Content-Type: application/problem+json` and the body `{ type: 'about:blank', title, status, code, detail?, errors? }`. An unmapped `QueryFailedError` answers `500 internal_error` without detail and logs `{ msg: 'Unhandled database error', err }` at `error`. Other exceptions are not caught, so Nest's other `HttpException` responses (terminus `/ready`, unknown routes) keep their current bodies and the health and logging e2e tests stay green. Unit test `src/http/problem-details.filter.spec.ts` with a fake `ArgumentsHost` and a fake response.
- [x] T008 [P] Create `src/http/zod-validation.pipe.ts`: `ZodValidationPipe(schema, source: 'body' | 'headers' | 'path')`. On failure, throw `DomainError('validation_failed')` with `errors` whose `path` is prefixed by the source (`body.amountMinor`, `headers.idempotency-key`). On success, return the parsed value (zod transforms apply). Unit test `src/http/zod-validation.pipe.spec.ts`.
- [x] T009 [P] Create `src/http/actor.ts` (research R5, [contract Actor headers](./contracts/http-api.md#actor-headers)): the header schema (`x-actor-role`: `'operator' | 'company'`; `x-actor-ref`: string, 1–200 characters; `x-company-id`: uuid, required when the role is `company`, rejected with the role `operator`); the type `Actor = { role: 'operator'; ref: string } | { role: 'company'; ref: string; companyId: string }`; a pure `parseActor(headers, allowedRoles)` that throws `validation_failed` on bad headers and `forbidden_role` on a role the endpoint does not accept; and the parameter decorator `ActorContext(...allowedRoles)` (`createParamDecorator`) that calls it with `request.headers`. Unit test `src/http/actor.spec.ts` covers `parseActor()`: each valid form, each missing or malformed header, the operator with a company id, each forbidden role.
- [x] T010 Create `src/http/http.module.ts` that provides `ProblemDetailsFilter` as `APP_FILTER`, and import `HttpModule` in `src/app.module.ts`, so every test that boots `AppModule` gets the filter.

### Ledger posting (research R2, R3)

- [x] T011 [P] Create `src/ledger/locked-accounts.ts`: class `LockedAccounts`, built from locked rows `{ id, type, balanceMinor }[]`. Method `apply(legs: { accountId: string; amountMinor: number }[])` checks that there are at least 2 legs, that no leg is 0, that the legs sum to 0, and that every account is locked (programming errors: plain `Error`). It computes each new balance; a `company_wallet` or `escrow` below 0, or a `bank_clearing` above 0, throws `DomainError('insufficient_balance')`. It keeps the new balances, so a second `apply()` in the same transaction starts from them, and it returns `{ accountId, amountMinor, balanceAfterMinor }[]`. Method `balanceOf(accountId)`. Every result must stay a safe integer (`Number.isSafeInteger`), or it throws. Method `post(manager: EntityManager, { type, source, actor, legs })` calls `apply(legs)`, updates `accounts.balance_minor` for each leg, inserts the `ledger_transfers` row (`type`, the one source id column, `actor_type`, `actor_ref` (null only for `system`), `entry_count = legs.length`) and one `ledger_entries` row per leg with `balance_after_minor`, and returns the transfer id. No Nest provider: it has no dependencies (research R3). Unit test `src/ledger/locked-accounts.spec.ts` covers every branch of `apply()` and `balanceOf()`; `post()` is covered by T016.
- [x] T012 Create `src/ledger/posting.ts` with plain exported functions, not a Nest provider (research R3): `lockAccounts(manager: EntityManager, accountIds: string[]): Promise<LockedAccounts>`, which runs `SELECT id, type, balance_minor FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE` (one statement, sorted: the lock order of R2) and throws if a row is missing; and `platformAccountIds(manager)`, which returns the ids of `escrow` and `bank_clearing` (read on every call, no cache). `src/ledger/ledger.module.ts` does not change.
- [x] T013 Create `src/deals/invoice-payment.service.ts`: `InvoicePaymentService.pay(manager, locked, { invoice, deal, buyerWalletId, escrowId, actor })`. Preconditions (the caller holds the locks of R2): the invoice is `issued`, the amount equals `deal.totalMinor`. It calls `locked.post()` for an `invoice_payment` transfer (buyer wallet `-amount`, escrow `+amount`, source `invoice_id`), sets the invoice to `status = 'paid'`, `paid_at = now()`, the deal to `status = 'paid'`, `updated_at = now()`, and inserts the `deal_status_changes` row `awaiting_payment` → `paid` with the actor ([data-model.md, Pay invoice](./data-model.md#pay-invoice-shared-by-the-top-up-and-by-a-purchase-paid-at-once)). `insufficient_balance` from posting propagates. Provide and export `InvoicePaymentService` in `src/deals/deals.module.ts`. `DealsModule` does not import `LedgerModule`: the posting functions are plain imports.

### Test helpers

- [x] T014 Extend `test/schema/helpers.ts`: `createInvoice()` accepts `issuedAt`, `dueAt` and `expiresAt` overrides (so a test can create an invoice that expired 10 or 40 days ago); add `walletBalance(db, companyId)` and `ledgerEntriesOf(db, transferId)`. Keep the existing defaults, so the schema tests do not change.
- [x] T015 Create `test/operations/helpers.ts`: `bootApp()` (compile `AppModule`, `createNestApplication()`, `init()`; used once per file in `beforeAll`, closed in `afterAll`); header builders `operatorHeaders(ref?)` and `companyHeaders(companyId, ref?)`; `expectProblem(response, status, code)`; and `expectWalletConsistent(db, companyIds)`, which checks for each given wallet that `balance_minor` equals the sum of its `ledger_entries` and that the newest entry's `balance_after_minor` equals the balance (SC-003, scoped to the test's own wallets as the rules above require).
- [x] T016 Create `test/operations/ledger-posting.e2e-spec.ts`, booting `AppModule` once and calling `lockAccounts()` and `LockedAccounts.post()` inside `app.get(DataSource).transaction()`: two transfers in one transaction on the same wallet write consecutive correct `balance_after_minor` values; a posting that takes a wallet below 0 throws `insufficient_balance` and leaves nothing written; locked rows come back for every requested id.

**Checkpoint**: `pnpm run test:cov` passes; the API has no new endpoint yet.

---

## Phase 3: User Story 1 - Buyer buys units of a lot (Priority: P1) 🎯 MVP

**Goal**: `POST /deals` reserves stock, creates the deal and its invoice, and with `payNow: true` pays the invoice from the wallet in the same step ([contract](./contracts/http-api.md#post-deals), [rows written](./data-model.md#buy-a-lot)).

**Independent Test**: A seller with a published lot (price 1,000.00 = `100000`, stock 5) and a buyer with a wallet. Buy 3 units: deal `awaiting_payment`, total `300000`, invoice `issued`, stock 2, no transfer.

### Tests for User Story 1 (write first, see them fail)

- [x] T017 [US1] Create `test/operations/purchase.e2e-spec.ts` (boot once): spec User Story 1 scenarios 1–7, each as its own test: (1) pay later: deal fields, invoice `issued` with `due_at = issued_at + 5 days` and `expires_at = due_at + 1 day`, stock 2, no `invoice_payment` transfer; (2) pay at once with balance `500000`: deal and invoice `paid`, two status change rows (`null` → `awaiting_payment`, `awaiting_payment` → `paid`, actor `buyer`), buyer balance `200000`, one `invoice_payment` transfer with entries `-300000` on the wallet and `+300000` on escrow; (3) pay at once with balance `200000`: `422 insufficient_balance`, no deal, stock unchanged; (4) stock 2, quantity 3: `422 insufficient_stock`; (5) same `Idempotency-Key` twice: second answer `200` with `Idempotent-Replayed: true` and the same deal id, one deal row; (6) 3 deals in `awaiting_payment` (fixtures), 4th pay later: `422 unpaid_deal_limit_reached`, the same with `payNow: true` and enough balance: `201`; (7) 2 `expired` deals with invoices that expired within 30 days: `422 prepay_only`, paid at once: `201`; with the same 2 deals expired 40 days ago: pay later allowed. Use the buyer's fresh settings-default limits (3, 2, 30 days) read from `platform_settings`, never change the shared row.
- [x] T018 [US1] Add the edge cases and error codes to `test/operations/purchase.e2e-spec.ts`: own lot `422 own_lot`; hidden lot and unknown lot `404 lot_not_found`; stock 0 `422 insufficient_stock`; quantity `0`, `-1`, `1.5` `400 validation_failed` with path `body.quantity`; quantity × price above `Number.MAX_SAFE_INTEGER` `422 amount_too_large` with stock unchanged; buyer without wallet `422 wallet_not_activated`; unknown `X-Company-Id` `422 company_not_found`; missing or non-uuid `Idempotency-Key` `400`; operator role `403 forbidden_role`; reused key with another quantity `422 idempotency_key_reused`; reused key with only another `payNow` answered as a replay (FR-021); a malformed JSON body `400 validation_failed` as problem details (FR-003); a price change after the purchase leaves the deal and invoice prices unchanged; after every money test, `expectWalletConsistent()`.
- [x] T019 [US1] Add the concurrency tests to `test/operations/purchase.e2e-spec.ts` (`Promise.all` of parallel requests): SC-001, 10 buyers and one lot with stock 1: exactly one `201`, nine `422 insufficient_stock`, stock 0; SC-002, one buyer with balance `500000` sends 10 pay-at-once purchases of `100000` each needing `1000000` in total: at most 5 succeed, the rest answer `insufficient_balance`, the balance ends at `500000 - 100000 × successes` and never below 0; SC-005, 5 parallel requests with one `Idempotency-Key`: one deal row, every answer has its id.

### Implementation for User Story 1

- [x] T020 [P] [US1] Create `src/deals/purchase.schema.ts`: body `z.strictObject({ lotId: z.uuid(), quantity: z.int().min(1).max(2147483647), payNow: z.boolean().default(false) })` and the header schema `idempotency-key: z.uuid()`. Unit test `src/deals/purchase.schema.spec.ts`.
- [x] T021 [US1] Create `src/deals/purchases.service.ts`: `PurchasesService.buy(actor, idempotencyKey, body)` in one `dataSource.transaction()`, steps in this order ([data-model.md, Buy a lot](./data-model.md#buy-a-lot), [contract check order](./contracts/http-api.md#post-deals)): (1) find the buyer wallet id by `company_id`; none: `company_not_found` if the company does not exist, else `wallet_not_activated`; (2) `lockAccounts()` on the wallet and, with `payNow`, escrow; (3) look up the deal by `(buyer_company_id, idempotency_key)`: same `lot_id` and `quantity` returns `{ replayed: true, deal, invoice }`, different returns `idempotency_key_reused`; (4) read `platform_settings`; pay later only: count `awaiting_payment` deals of the buyer `>= max_unpaid_deals` gives `unpaid_deal_limit_reached`; count `expired` deals whose invoice `expires_at > now() - make_interval(days => expiry_lookback_days)` `>= expiry_limit` gives `prepay_only`; (5) `UPDATE lots SET stock_available = stock_available - $q, updated_at = now() WHERE id = $1 AND status = 'published' AND stock_available >= $q AND seller_company_id <> $buyer AND $q * unit_price_minor <= 9007199254740991 RETURNING unit_price_minor, seller_company_id`; no row: read the lot without lock and answer `lot_not_found` (missing or hidden), `own_lot`, `amount_too_large` or `insufficient_stock`, in that order; (6) insert the deal (`awaiting_payment`, `total_minor = q × price`), the status change (`null` → `awaiting_payment`, actor `buyer`, `actor_ref` from the actor), the invoice (`issued`, `issued_at = now()`, `due_at = now() + make_interval(days => payment_window_days)`, `expires_at = due_at + make_interval(days => grace_period_days)`, number from the column default) and read the invoice number back; (7) with `payNow`, `InvoicePaymentService.pay()` with the buyer as actor. No handler for a `deals_buyer_idempotency_key_key` violation: the wallet lock makes it impossible (research R9). Log `Deal created` with `dealId`, `lotId`, `buyerCompanyId`, `totalMinor`, `paid` (R12).
- [x] T022 [US1] Create `src/deals/deals.controller.ts`: `POST /deals` with `@ActorContext('company')`, the body and `Idempotency-Key` header through `ZodValidationPipe`, calling `PurchasesService.buy()`. Answer `201`, or `200` with the header `Idempotent-Replayed: true` for a replay (`@Res({ passthrough: true })`). Map the result to the response body of the contract (money as numbers, times as ISO strings, `paidAt` null when unpaid). Register the controller and `PurchasesService` in `src/deals/deals.module.ts`.

**Checkpoint**: `pnpm exec vitest run --project e2e test/operations/purchase.e2e-spec.ts` passes. User Story 1 works on its own.

---

## Phase 4: User Story 2 - Operator tops up a company wallet (Priority: P1)

**Goal**: `POST /top-ups` records a bank notification, credits the wallet and, if it names a covered `issued` invoice of the same company, pays it in the same step ([contract](./contracts/http-api.md#post-top-ups), [rows written](./data-model.md#top-up-wallet)).

**Independent Test**: A company with balance 0. Top up `300000` with reference "TRX-1": balance `300000`, one `top_up` transfer with entries `-300000` on bank clearing and `+300000` on the wallet, actor `operator`.

### Tests for User Story 2 (write first, see them fail)

- [ ] T023 [US2] Create `test/operations/top-up.e2e-spec.ts` (boot once), spec User Story 2 scenarios 1–7 each as its own test. Use a random reference per test (`unique('TRX').toUpperCase()`). (1) credit only; (2) the same reference sent as lower case with spaces: `409 bank_reference_already_recorded`, balance unchanged; (3) company without wallet: `422 wallet_not_activated`, no `top_ups` row; (4) amount `0` and `-1`: `400 validation_failed`; (5) names an `issued` invoice of a deal in `awaiting_payment` (fixtures) and covers it: two transfers, `top_up` then `invoice_payment`, wallet back to 0, invoice and deal `paid`, status change actor `operator`, `paidInvoiceId` set; (6) names it but does not cover it: wallet `200000`, invoice and deal unchanged, `paidInvoiceId: null`; (7) names an invoice of another company, and a `paid` invoice: money stays in the wallet, invoices unchanged, the link is stored in `top_ups.invoice_id`.
- [ ] T024 [US2] Add the edge cases and races to `test/operations/top-up.e2e-spec.ts`: an unknown `invoiceId` `422 invoice_not_found`; unknown company `422 company_not_found`; a reference with characters outside the allowed set, or longer than 140 characters after normalization, `400`; a transfer date that is not a calendar date (`2026-02-30`) or more than 1 day in the future `400`; a company role `403 forbidden_role`; an invoice whose deal already `expired`: money stays, deal stays `expired`; a top-up larger than the invoice: invoice paid, remainder in the wallet; two parallel top-ups with one reference: exactly one `201`, one `409`; two parallel top-ups with different references that name one invoice: the invoice is paid once, the second top-up's money stays in the wallet; `expectWalletConsistent()` after each.

### Implementation for User Story 2

- [ ] T025 [P] [US2] Create `src/wallets/top-up.schema.ts`: `normalizeBankReference(value)` removes all whitespace (`/\s+/g`) and upper-cases; the body `z.strictObject({ companyId: z.uuid(), amountMinor: z.int().positive().max(Number.MAX_SAFE_INTEGER), bankReference: z.string().transform(normalizeBankReference).pipe(z.string().min(1).max(140).regex(/^[A-Z0-9/?:().,'+-]+$/)), transferDate: <YYYY-MM-DD that is a real date and not later than the UTC date of tomorrow>, invoiceId: z.uuid().optional() })`. Unit test `src/wallets/top-up.schema.spec.ts`: normalization, each limit, leap day, the date bound with a fixed clock (`vi.setSystemTime`).
- [ ] T026 [US2] Create `src/wallets/top-ups.service.ts`: `TopUpsService.record(actor, body)` in one transaction ([data-model.md, Top up wallet](./data-model.md#top-up-wallet)): (1) find the wallet by `company_id` (`company_not_found` or `wallet_not_activated` as in T021); (2) `lockAccounts()` on the wallet, bank clearing and, when `invoiceId` is set, escrow; (3) with `invoiceId`: `SELECT` the invoice and its deal `FOR UPDATE` (`invoice_not_found` if missing); (4) insert `top_ups` (`operator_ref` from the actor, `transfer_date`, `invoice_id`); (5) `locked.post()` the `top_up` transfer (bank clearing `-amount`, wallet `+amount`, actor `operator`); (6) when the invoice is `issued`, its deal's `buyer_company_id` is the company and `locked.balanceOf(wallet) >= invoice.amount_minor`, `InvoicePaymentService.pay()` with the operator as actor. Return the top-up, the wallet balance after the operation and `paidInvoiceId`. Log `Top-up recorded` with `topUpId`, `companyId`, `amountMinor`, `paidInvoiceId`.
- [ ] T027 [US2] Create `src/wallets/top-ups.controller.ts` (`POST /top-ups`, `@ActorContext('operator')`, body through `ZodValidationPipe`, `201` with the contract body) and `src/wallets/wallets.module.ts` (imports `DealsModule`, provides `TopUpsService`, declares the controller). Import `WalletsModule` in `src/app.module.ts`.

**Checkpoint**: `pnpm exec vitest run --project e2e test/operations/top-up.e2e-spec.ts` passes. A deal from US1 can be paid by a top-up.

---

## Phase 5: User Story 3 - Seller changes the price of a lot (Priority: P2)

**Goal**: `POST /lots/{lotId}/price-changes` sets a new price and adds a history row; existing deals keep their price ([contract](./contracts/http-api.md#post-lotslotidprice-changes), [rows written](./data-model.md#update-the-price-of-a-lot)).

**Independent Test**: A lot at `100000`. The seller sets `120000`: lot price `120000`, one new `lot_price_changes` row from `100000` to `120000`, actor type `seller`.

### Tests for User Story 3 (write first, see them fail)

- [ ] T028 [US3] Create `test/operations/price-change.e2e-spec.ts` (boot once), spec User Story 3 scenarios 1–5 and edge cases: (1) seller change: lot and history row, `actorType: 'seller'`, `id` a string; operator change: `actorType: 'operator'`; (2) a deal at `100000` keeps its unit price and total, and its invoice its amount; (3) same price `409 price_unchanged`, no history row; (4) another company on a published lot `403 not_lot_seller`, on a hidden lot `404 lot_not_found`; (5) `0`, `-1`, `1.5` and `Number.MAX_SAFE_INTEGER + 2` `400 validation_failed`; unknown lot and non-uuid `lotId` `404` and `400`; a hidden lot's own seller may change its price and the lot stays hidden; two parallel changes to `110000` and `120000`: both `201`, two history rows where the second row's `old_price_minor` equals the first row's `new_price_minor`, and the lot price equals the newest row (SC-007).

### Implementation for User Story 3

- [ ] T029 [P] [US3] Create `src/catalog/price-change.schema.ts`: body `z.strictObject({ unitPriceMinor: z.int().positive().max(Number.MAX_SAFE_INTEGER) })`, path `lotId: z.uuid()`. Unit test `src/catalog/price-change.schema.spec.ts`.
- [ ] T030 [US3] Create `src/catalog/lot-pricing.service.ts`: `LotPricingService.changePrice(actor, lotId, unitPriceMinor)` in one transaction: `SELECT id, seller_company_id, status, unit_price_minor FROM lots WHERE id = $1 FOR UPDATE`; missing: `lot_not_found`; company actor that is not the seller: `lot_not_found` when the lot is hidden, else `not_lot_seller`; same price: `price_unchanged`; `UPDATE lots SET unit_price_minor = $2, updated_at = now()`; insert `lot_price_changes` (`old_price_minor`, `new_price_minor`, `actor_type` `seller` for a company actor and `operator` for an operator, `actor_ref`) returning `id` and `changed_at`. Log `Lot price changed` with `lotId`, `oldPriceMinor`, `newPriceMinor`.
- [ ] T031 [US3] Create `src/catalog/lots.controller.ts` (`POST /lots/:lotId/price-changes`, `@ActorContext('company', 'operator')`, path and body through `ZodValidationPipe`, `201` with the contract body) and register it with `LotPricingService` in `src/catalog/catalog.module.ts`.

**Checkpoint**: All three stories pass their e2e files.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T032 Create `test/operations/reconciliation.e2e-spec.ts` (SC-003, FR-005). It runs on its own throwaway database, because the schema tests commit unbalanced ledger rows to the shared one. In `beforeAll`: create the database from `inject('databaseUrl')` as `test/schema/migrations.e2e-spec.ts` does, run `loadMigrations()` on it, set `process.env.DATABASE_URL` to it and boot `AppModule`; in `afterAll`, close the app, restore the variable and drop the database. Create sellers, buyers and lots with the `test/schema/helpers.ts` fixtures, then run through the API: 3 top-ups (one that pays an invoice, one that does not cover it), 4 purchases (2 pay later, 2 pay at once, 1 more rejected for balance), 2 price changes, and 5 parallel pay-at-once purchases by one buyer. After each step, assert the three reconciliation queries of `specs/001-marketplace-data-model/data-model.md`: no account whose balance differs from the sum of its entries; `SUM(balance_minor)` over all accounts is 0; the escrow balance minus the totals of deals in `paid`, `shipped` or `disputed` is 0.
- [ ] T033 [P] Update `AGENTS.md` Architecture: the three operations and where they live (`src/deals/`, `src/wallets/`, `src/catalog/`, `src/http/`); the lock order of research R2 (accounts in one sorted `FOR UPDATE`, then the invoice, then the lot) as a rule for every new money operation; every money movement goes through `lockAccounts()` and `LockedAccounts.post()` in `src/ledger/`; errors are `DomainError` codes answered as RFC 9457 problem details, and a new database rule that a race can hit gets an entry in `src/http/constraint-errors.ts`; the actor headers are trusted as sent and the API must stay inside a trusted network until the security feature.
- [ ] T034 [P] Add an "API" section to `README.md` after "Run": the three endpoints with one line each, the actor headers, a link to `specs/003-marketplace-operations/contracts/http-api.md`, and the trusted-headers warning.
- [ ] T035 Run `pnpm run migration:check --pretty` against the local database (`pnpm run docker:up`, `pnpm run migration:run` first): no drift, since the feature changes no entity.
- [ ] T036 Run the manual steps of [quickstart.md](./quickstart.md#manual-run) against `pnpm run start:dev` and fix any step that does not match the API.
- [ ] T037 Run `pnpm exec prettier --write` on the changed `*.md`, `package.json` and `vitest.config.ts`, then `pnpm run ci`. The task is done only when it passes.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** (T001–T004): none. T003 needs T001 and T002. Phase 1 blocks everything, because coverage cannot pass without it.
- **Phase 2** (T005–T016): needs Phase 1. Blocks all stories.
- **Phase 3 (US1)**, **Phase 4 (US2)**, **Phase 5 (US3)**: each needs only Phase 2. US2's invoice tests use fixtures, not US1's endpoint, so US2 does not wait for US1.
- **Phase 6**: T032 needs all three stories; T033–T036 need the stories they document; T037 is last.

### Within Phase 2

- T005 before T006, T007, T008, T009 (they throw `DomainError`).
- T007 before T010. T011 before T012. T012 before T013 and T016. T014 before T015 and T016.

### Within each story

- Tests first (T017–T019, T023–T024, T028), then the schema, the service, the controller.
- T021 needs T013 and T020; T022 needs T021. T026 needs T013 and T025; T027 needs T026. T030 before T031.

## Parallel Opportunities

- Phase 2: T005 first, then T006, T008, T009, T011 and T014 in parallel.
- After Phase 2, the three stories can run in parallel: they touch different folders (`src/deals/`, `src/wallets/`, `src/catalog/`) and different test files. They share `src/app.module.ts` only in T027.
- Within a story, the schema task ([P]) runs in parallel with writing the e2e tests.
- Phase 6: T032, T033 and T034 in parallel.

### Parallel example: User Story 1

```text
Task: "T017–T019 e2e tests in test/operations/purchase.e2e-spec.ts"
Task: "T020 purchase schemas in src/deals/purchase.schema.ts"
```

## Implementation Strategy

### MVP first

1. Phase 1, and stop if the T003 spike fails.
2. Phase 2.
3. Phase 3 (US1): buyers can buy, pay later or at once. Validate with `purchase.e2e-spec.ts`.

### Incremental delivery

1. Setup and Foundational: the error format, the actor headers and the ledger posting are ready.
2. US1: buying works, money moves only for pay-at-once purchases.
3. US2: money enters the platform, and a top-up pays an open invoice.
4. US3: sellers change prices.
5. Polish and `pnpm run ci`.

Commit after each task or logical group (Conventional Commits, for example `test(deals): …`, `feat(deals): …`), on branch `003-marketplace-operations`.
