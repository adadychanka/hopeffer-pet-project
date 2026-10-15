# Implementation Plan: Marketplace Data Model

**Branch**: `001-marketplace-data-model` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-marketplace-data-model/spec.md`

## Summary

Design the PostgreSQL data model of the marketplace: companies, lots and photos, deals with invoices and a status history, and money in a double-entry ledger with company wallets, an escrow account and a bank clearing account. Money enters only through operator top-ups, moves to escrow when an invoice is paid, and leaves escrow as a payout to the seller or a refund to the buyer. The outcome is documentation only: [data-model.md](./data-model.md) with the Mermaid ERD, `erd.drawio.svg` in this folder, and a new case version `docs/system-design/marketplace-v2/` with a copy of the ERD. No application code, entity or migration changes.

## Technical Context

**Language/Version**: No application code in this feature. The model targets the existing stack: TypeScript, NestJS 12, TypeORM, Node 24.

**Primary Dependencies**: None added. The draw.io file is generated with a throwaway Node script outside the repository, as the existing C4 diagrams were.

**Storage**: PostgreSQL 17 (`postgres:17.11-alpine`). Photo files in S3-compatible object storage (RustFS locally); the database stores only the object key.

**Testing**: No tests: no code. The quickstart validates the documents: Mermaid renders, the draw.io file opens, the v2 copy is byte-identical, the spec scenarios can be traced through the model, and `pnpm run ci` passes.

**Target Platform**: Documentation in the repository, rendered by GitHub (Markdown, Mermaid, SVG) and editable in draw.io.

**Project Type**: Web service (NestJS backend). This feature changes documentation only.

**Performance Goals**: From the v1 case: a few deals per day, each one expensive. The model favors correctness over write throughput: row locks per buyer wallet, synchronous double-entry writes.

**Constraints**: Money exact (integer minor units); ledger append-only; every status change and money movement atomic; settings changes apply to new deals only.

**Scale/Scope**: 12 tables. Thousands of lots, a few deals per day, a few ledger entries per deal. No partitioning needed.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                           | Status         | Notes                                                                                                                                                                                                                                                           |
| ----------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. CI Defines Done                  | Pass           | `pnpm run ci` must pass before the feature is done, even though only documents change. `format:check` covers only `src/` and `test/`, so changed Markdown files are formatted with `pnpm exec prettier --write`. Commits follow Conventional Commits (`docs:`). |
| II. Tests Against Real Dependencies | Pass (no code) | The model is designed so the implementing feature can test every invariant against the real Postgres container: constraints and triggers live in the database, not in mocks.                                                                                    |
| III. Validated Configuration        | Pass           | No new environment settings. Business limits that the operator changes at run time live in `platform_settings` as data (R5); they are not deployment configuration.                                                                                             |
| IV. Migrations Own the Schema       | Pass           | No migration in this feature. The model avoids PostgreSQL enum types so that each later migration stays reversible (R8). Entity files will follow `*.entity.ts`.                                                                                                |
| V. Structured, Secret-Free Logging  | Pass (no code) | Not affected.                                                                                                                                                                                                                                                   |
| VI. Operable Lifecycle              | Pass (no code) | No new backing service. The reconciliation queries in `data-model.md` are candidates for a later readiness or admin check.                                                                                                                                      |
| VII. Pinned Supply Chain            | Pass           | No dependency added to `package.json`. Diagram tools run from a scratch directory and are not committed.                                                                                                                                                        |
| Tech constraints                    | Pass           | PostgreSQL and S3 only; no new backing service.                                                                                                                                                                                                                 |
| Workflow                            | Pass           | Spec Kit folder committed with the feature; work on branch `001-marketplace-data-model`, merged by pull request.                                                                                                                                                |

**Post-design re-check (after Phase 1)**: Pass. The design added a deferred constraint trigger and an append-only trigger (R4). They are schema objects that the implementing feature creates in a reversible migration, so Principle IV still holds. No Complexity Tracking entry needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-marketplace-data-model/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R13
├── data-model.md        # Phase 1: tables, Mermaid ERD, lifecycles, flows, invariants
├── quickstart.md        # Phase 1: how to validate the documents
├── erd.drawio.svg       # Implementation: draw.io ERD (picture + editable source)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks)
```

No `contracts/` folder: this feature exposes no interface. API contracts belong to the features that implement the entities.

### Other files this feature adds

```text
docs/system-design/marketplace-v2/
├── README.md            # v1 case carried over, new money flow, ERD, link to the spec
└── erd.drawio.svg       # byte-identical copy of specs/001-marketplace-data-model/erd.drawio.svg
```

Not changed (FR-038, FR-039): `docs/architecture/`, the Architecture section of `README.md`, `docs/system-design/marketplace-v1/`. One exception (FR-038): the README sentence "Everything that is planned is in a separate case" links to v2 instead of v1.

### Source code (later features, not this one)

The implementing features are expected to add one Nest module per area, each with its `*.entity.ts` files and `TypeOrmModule.forFeature`:

```text
src/
├── companies/   # companies, accounts (wallet created with the company)
├── catalog/     # lots, lot_photos (S3 keys)
├── deals/       # deals, deal_status_changes, invoices
├── ledger/      # ledger_transfers, ledger_entries, top_ups, corrections
└── settings/    # platform_settings
```

**Structure Decision**: Documentation-only feature. Files go in the feature folder and in a new case version folder. The source layout above is a hint for later features and is not created now.

## Implementation Outline (for /speckit-tasks)

1. Generate `erd.drawio.svg` from the tables and relationships in `data-model.md`: SVG picture plus the uncompressed draw.io model in the `content` attribute, English labels, crow's foot notation, money tables grouped apart from catalog and deal tables. Render-check it with `@resvg/resvg-js` from a scratch directory.
2. Create `docs/system-design/marketplace-v2/README.md`: carry over the v1 case, replace the "marketplace does not move money" assumption with the wallet, invoice and escrow flow, add the deal lifecycle and the ERD picture, link to `specs/001-marketplace-data-model/`. Reuse v1's growth map by relative link unless it changes.
3. Copy `erd.drawio.svg` into the v2 folder and check it with `cmp`.
4. Run the [quickstart](./quickstart.md) checks and `pnpm run ci`.

## Complexity Tracking

No violations.
