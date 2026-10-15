---
description: 'Task list for the marketplace data model (documentation-only feature)'
---

# Tasks: Marketplace Data Model

**Input**: Design documents from `specs/001-marketplace-data-model/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: No code, so no test tasks. Each user story phase is a design review: trace the story's acceptance scenarios through `data-model.md` and the ERD, and fix any gap. `quickstart.md` holds the final checks.

**Organization**: One diagram serves every story, so the draw.io ERD is foundational (Phase 2). Each story phase then checks that the model and the diagram cover that story. The v2 case folder (FR-039) and the final checks come last.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)

## Path Conventions

- Feature documents: `specs/001-marketplace-data-model/`
- New case version: `docs/system-design/marketplace-v2/`
- Throwaway build tools: `$TMPDIR/erd-build/` (never committed)
- Must not change (FR-038, FR-039): `docs/architecture/`, the Architecture section of `README.md` (except the planned-case link, T020), `docs/system-design/marketplace-v1/`

---

## Phase 1: Setup

**Purpose**: Branch and tools for building the diagram

- [x] T001 Create and switch to branch `001-marketplace-data-model` in the main checkout (`git checkout -b 001-marketplace-data-model`); the uncommitted `specs/001-marketplace-data-model/` files move with it
- [x] T002 [P] Create `$TMPDIR/erd-build/` with its own `package.json` and install `@resvg/resvg-js` there (`npm install --cache "$TMPDIR/npm-cache" @resvg/resvg-js`); do not add it to the repository's `package.json` (Constitution VII)
- [x] T003 [P] Read the file format of `docs/system-design/marketplace-v1/growth-map.drawio.svg`: XML header comment, `<svg>` with `width`/`height`/`viewBox`, and the uncompressed `<mxfile>` XML (HTML-escaped) in the `content` attribute. The new ERD file uses the same format

---

## Phase 2: Foundational (the draw.io ERD)

**Purpose**: The one diagram every story review uses

**⚠️ CRITICAL**: Story reviews (Phases 3–8) read this diagram

- [x] T004 Write the generator `$TMPDIR/erd-build/build-erd.mjs`. It holds the 12 tables as data, copied exactly from the Mermaid `erDiagram` block in `specs/001-marketplace-data-model/data-model.md`: table names, every column with its type and its `PK`/`FK`/`UK` marker, in the same order. Each table is a draw.io swimlane table shape (`shape=table` with one row per column) so it stays editable in draw.io
- [x] T005 In `$TMPDIR/erd-build/build-erd.mjs`, lay the tables out in three labelled groups with dashed frames: **Catalog** (`companies`, `lots`, `lot_photos`), **Deals** (`deals`, `deal_status_changes`, `invoices`), **Money** (`accounts`, `ledger_transfers`, `ledger_entries`, `top_ups`, `corrections`), with `platform_settings` standing alone and a note "values copied into invoices and deals at creation (R5)"
  - Done differently: the groups are shown by header colour and a legend, not dashed frames. In the grid layout the Money group is L-shaped, and a frame around it would cross the edges.
- [x] T006 In `$TMPDIR/erd-build/build-erd.mjs`, add the 18 relationships of the Mermaid block as orthogonal edges with crow's foot ends (`endArrow=ERmany`/`ERmandOne`/`ERzeroToOne`/`ERzeroToMany`/`ERoneToMany`, and the matching `startArrow`), each with the same cardinality and the same label as in Mermaid (for example `companies ||--o| accounts : "owns wallet"`). Draw the two `companies`–`deals` edges ("buys in", "sells in") as separate edges
- [x] T007 In `$TMPDIR/erd-build/build-erd.mjs`, add a title ("Marketplace data model") and a legend: crow's foot meanings, `PK`/`FK`/`UK`, "money columns are bigint minor units (`*_minor`)", "ledger entries are signed: + into the account, − out of it". All labels in English
- [x] T008 Run `node $TMPDIR/erd-build/build-erd.mjs` to write `specs/001-marketplace-data-model/erd.drawio.svg`: the SVG picture of the diagram plus the uncompressed `<mxfile>` in the `content` attribute, with the same header comment as the v1 growth map
- [x] T009 Render `specs/001-marketplace-data-model/erd.drawio.svg` to `$TMPDIR/erd-build/erd.png` with `@resvg/resvg-js` and look at the PNG: no overlapping tables, no edge through a table, every label readable, nothing cut off at the edges. Fix the layout in `build-erd.mjs` and repeat T008–T009 until clean

**Checkpoint**: `erd.drawio.svg` shows all 12 tables and 18 relationships

---

## Phase 3: User Story 1 - Buyer purchases units of a lot (Priority: P1) 🎯 MVP

**Goal**: The model records a purchase with reserved stock and an issued invoice

**Independent Test**: Walk US1 scenarios 1–4 in `spec.md` through the "Flows" row "Purchase" in `data-model.md`: every fact has a column, and every rejection maps to a row in "Invariants"

- [x] T010 [US1] Trace US1 scenarios 1–4 through `specs/001-marketplace-data-model/data-model.md`: `deals` (`quantity`, `unit_price_minor`, `total_minor`, `status` = `awaiting_payment`), `invoices` (`number`, `due_at` = `issued_at + payment_window_days`), `lots.stock_available` reduced, `deal_status_changes` first row. Scenario 3 (paid at once) must produce the `invoice_payment` transfer. Scenario 4 (stock 2, buy 3) must map to "Stock never below 0, no oversell". Fix `data-model.md` and `$TMPDIR/erd-build/build-erd.mjs` if a fact has no column, then rerun T008–T009

---

## Phase 4: User Story 2 - Operator records a top-up that pays an invoice (Priority: P1)

**Goal**: The model records a top-up, links it to an invoice and pays the invoice in the same step

**Independent Test**: Walk US2 scenarios 1–5 through the "Top-up", "Pay invoice" and "Correction" flows

- [x] T011 [US2] Trace US2 scenarios 1–5 through `specs/001-marketplace-data-model/data-model.md`: `top_ups` (`bank_reference` "`UNIQUE`; trimmed and upper case (R12)", `invoice_id` optional), the `top_up` transfer (`bank_clearing` out, company wallet in), the `invoice_payment` transfer (buyer wallet out, `escrow` in), the duplicate `TRX-1` rejection, and the correction with `reason` "not null, 1–1000 chars". Fix `data-model.md` and the generator if anything is missing, then rerun T008–T009

---

## Phase 5: User Story 3 - Delivery and payout to the seller (Priority: P1)

**Goal**: The model records shipping, confirmation (by the buyer or by the job) and the payout

**Independent Test**: Walk US3 scenarios 1–4 through the "Ship" and "Confirm" flows and the deal state diagram

- [x] T012 [US3] Trace US3 scenarios 1–4 through `specs/001-marketplace-data-model/data-model.md`: `deals.confirmation_due_at` "null until shipped; `shipped_at + confirmation_window_days`", the `payout` transfer (`escrow` out, seller wallet in), the automatic confirmation as a `deal_status_changes` row with `actor_type = 'system'`, and the rejected shipping of an `awaiting_payment` deal (no such edge in the state diagram). Fix if needed, then rerun T008–T009

---

## Phase 6: User Story 4 - Cancellation, expiry, refund and abuse protection (Priority: P2)

**Goal**: The model supports every way a deal ends without a payout, and the buyer limits

**Independent Test**: Walk US4 scenarios 1–7 through the "Cancel or expire unpaid", "Refund" and "Claim" flows and the prepay-only rule

- [x] T013 [US4] Trace US4 scenarios 1–7 through `specs/001-marketplace-data-model/data-model.md`: stock returned on cancel, expiry and refund before shipping (not after shipping), `invoices.expires_at` "`due_at + grace_period_days`", the unpaid limit (deals in `awaiting_payment` against `max_unpaid_deals`), the prepay-only rule (expired deals within `expiry_lookback_days` against `expiry_limit`), the `disputed` status, and the `refund` transfer with a reason. Fix if needed, then rerun T008–T009

---

## Phase 7: User Story 5 - Seller manages a lot and its photos (Priority: P2)

**Goal**: The model records lots, visibility and photo metadata

**Independent Test**: Walk US5 scenarios 1–4 through the `lots` and `lot_photos` tables

- [x] T014 [P] [US5] Trace US5 scenarios 1–4 through `specs/001-marketplace-data-model/data-model.md`: `lots.status` "`hidden`, `published`; default `hidden`", every photo field of scenario 3 (`storage_key` "not null, `UNIQUE`; the object key in the S3 bucket", `original_filename`, `content_type`, `size_bytes`, `width_px`, `height_px`, `position`, `uploaded_at`), and deletion blocked by `ON DELETE RESTRICT` once a deal exists. Fix if needed, then rerun T008–T009

---

## Phase 8: User Story 6 - Company and operator review the money history (Priority: P3)

**Goal**: The model explains every balance from its entries

**Independent Test**: Run the three reconciliation queries in `data-model.md` in your head against a top-up, an invoice payment and a payout

- [x] T015 [P] [US6] Trace US6 scenarios 1–3 through `specs/001-marketplace-data-model/data-model.md`: statement order by `ledger_entries.id`, `balance_after_minor` on every entry, transfer entries summing to 0 (deferred trigger, R4), and the path payout entry → `ledger_transfers.deal_id` → `deals` → `invoices` → `invoice_payment` transfer with the same amount. Fix if needed, then rerun T008–T009

**Checkpoint**: All six stories trace through the model; `erd.drawio.svg` is final

---

## Phase 9: Case version v2 (FR-039)

**Purpose**: The target system with the new money flow, as the next course step

- [x] T016 Create `docs/system-design/marketplace-v2/README.md` from `docs/system-design/marketplace-v1/README.md`: title "Marketplace v2: heavy equipment marketplace"; carry over the case, the decisions, the components, the growth signals, the growth scenarios and the references. Show the growth map from v1 by relative link (`../marketplace-v1/growth-map.drawio.svg`) and say it is unchanged. Write in English
- [x] T017 In `docs/system-design/marketplace-v2/README.md`, add a section "What changed since v1": money moves inside the platform through company wallets, invoices and escrow; replace the v1 assumption "The marketplace does not move money itself…" with the new one (operator records top-ups from bank notifications; no payouts to banks)
- [x] T018 In `docs/system-design/marketplace-v2/README.md`, add a section "Data model": the deal lifecycle in short (purchase → invoice → escrow → shipped → payout, with cancel, expiry, dispute and refund), the abuse protection limits, the ERD picture `![Marketplace v2 data model](./erd.drawio.svg)` with a note that it opens in draw.io, and a link to `../../../specs/001-marketplace-data-model/` for the full spec, plan and data model
- [x] T019 Copy `specs/001-marketplace-data-model/erd.drawio.svg` to `docs/system-design/marketplace-v2/erd.drawio.svg` and check `cmp` prints nothing
- [x] T020 [P] In `README.md`, change only the sentence "Everything that is planned is in a separate case: [Marketplace v1](docs/system-design/marketplace-v1/README.md)." to "Everything that is planned is in a separate case: [Marketplace v2](docs/system-design/marketplace-v2/README.md) (previous version: [v1](docs/system-design/marketplace-v1/README.md))." No other line of `README.md` changes (FR-038 exception)

---

## Phase 10: Polish & Final Checks

**Purpose**: Formatting, quickstart, CI

- [x] T021 Run `pnpm exec prettier --write specs/001-marketplace-data-model docs/system-design/marketplace-v2 README.md` (Markdown outside `src/` and `test/` is not covered by `format:check`)
- [x] T022 Run quickstart checks 1–5 from `specs/001-marketplace-data-model/quickstart.md`: files exist, `git diff --stat main -- docs/architecture docs/system-design/marketplace-v1` is empty, `git diff main -- README.md` shows only the T020 line, the v2 copy is identical, both Mermaid blocks parse, the ERD matches the Mermaid diagram table by table
- [x] T023 Run `pnpm run ci` (Docker must run). If it fails, the feature is not done: fix and rerun, or report the failing output
- [x] T024 Mark finished tasks `[X]` in `specs/001-marketplace-data-model/tasks.md`, then ask the user before committing. On approval, stage by explicit path (`specs/001-marketplace-data-model/`, `docs/system-design/marketplace-v2/`, `README.md`) and commit with a Conventional Commits `docs:` message

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: needs T002 and T003; blocks the story reviews
- **Story reviews (Phases 3–8)**: need Phase 2. They can change `data-model.md` and the generator, so run them one after another, in priority order. T014 and T015 touch tables no other review touches and can run in parallel with each other
- **Case v2 (Phase 9)**: needs the final ERD (end of Phase 8)
- **Polish (Phase 10)**: needs everything above

### Within Phase 2

T004 → T005 → T006 → T007 (same file) → T008 → T009

### Within Phase 9

T016 → T017 → T018 (same file); T019 can run as soon as the ERD is final; T020 can run any time in this phase

---

## Parallel Example

```bash
# Setup:
Task: "Install @resvg/resvg-js in $TMPDIR/erd-build/"        # T002
Task: "Read the drawio.svg format of the v1 growth map"      # T003

# Story reviews with no shared tables:
Task: "Trace US5 through lots and lot_photos"                # T014
Task: "Trace US6 through the ledger"                         # T015

# Case v2:
Task: "Write marketplace-v2/README.md"                       # T016–T018
Task: "Copy erd.drawio.svg into marketplace-v2/"             # T019, after Phase 8
```

---

## Implementation Strategy

### MVP first

1. Phases 1–2: the ERD exists.
2. Phase 3 (US1): the core purchase traces through. Stop and look at the diagram.

### Incremental delivery

1. ERD → US1 → US2 → US3: the full happy path of a deal, from purchase to payout.
2. US4: every way a deal ends without a payout, plus the buyer limits.
3. US5, US6: catalog and statements.
4. Case v2, then the final checks and one commit.

---

## Notes

- One commit for the feature is enough: it is documentation only.
- Never write to `docs/architecture/` or `docs/system-design/marketplace-v1/`. In `README.md`, change only the planned-case link (T020).
- The generator and its `node_modules` stay in `$TMPDIR/erd-build/`; only `erd.drawio.svg` is committed.
