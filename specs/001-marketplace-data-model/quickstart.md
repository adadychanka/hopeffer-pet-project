# Quickstart: Validate the Marketplace Data Model

This feature produces documents, not code. These checks prove the documents are complete and consistent. Details live in [data-model.md](./data-model.md); this guide only says how to check them.

## Prerequisites

- Repository dependencies installed (`pnpm install`).
- Docker running, for `pnpm run ci` (secret scan and e2e tests).
- A browser for GitHub preview or [draw.io](https://app.diagrams.net/).

## 1. Files exist where FR-037 to FR-039 require

```bash
ls specs/001-marketplace-data-model/{data-model.md,erd.drawio.svg}
ls docs/system-design/marketplace-v2/{README.md,erd.drawio.svg}
git diff --stat main -- docs/architecture docs/system-design/marketplace-v1
git diff main -- README.md
```

Expected: all four files are listed; the first `git diff` prints nothing (current-state docs and v1 unchanged); the second shows only the planned-case sentence, now linking to v2 (FR-038 exception).

## 2. The v2 ERD is an exact copy

```bash
cmp specs/001-marketplace-data-model/erd.drawio.svg docs/system-design/marketplace-v2/erd.drawio.svg && echo identical
```

Expected: `identical`.

## 3. Diagrams render

- Open `data-model.md` in the GitHub preview (or any Mermaid viewer). Expected: the ERD and the deal state diagram render without a syntax error, with 12 tables.
- Open `erd.drawio.svg` in a browser. Expected: the picture shows the same 12 tables and relationships.
- Open `erd.drawio.svg` in draw.io (File → Open). Expected: it opens as an editable diagram, not as a flat image.
- Open `docs/system-design/marketplace-v2/README.md` in the GitHub preview. Expected: the ERD picture shows inline.

## 4. Diagram matches the data model

For each table in `data-model.md`, check that the draw.io ERD shows the same table name, the same PK, FK and UK columns, and each relationship with the same cardinality as the Mermaid diagram.

## 5. Trace the spec through the model (SC-009)

Without the spec open, answer each question from the ERD alone, and note the tables used. Target: under 5 minutes in total.

| Question                                              | Expected path                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Who bought what, from whom?                           | `deals` → `buyer_company_id`, `seller_company_id`, `lot_id`                       |
| How many units, at what price?                        | `deals.quantity`, `deals.unit_price_minor`, `deals.total_minor`                   |
| Whose wallet was topped up, when, by how much?        | `top_ups` → `company_id`, `recorded_at`, `transfer_date`, `amount_minor`          |
| What was debited and credited?                        | `ledger_entries` (signed `amount_minor`) → `ledger_transfers.type` and its source |
| Where is a buyer's money while a deal is in progress? | `accounts` (`escrow`) via the `invoice_payment` transfer                          |

Then walk the acceptance scenarios of User Stories 1–4 against the "Flows" table in `data-model.md`. Expected: every fact a scenario produces has a column to live in, and every rejection in the scenarios maps to a row in the "Invariants" table.

## 6. Formatting and CI

```bash
pnpm exec prettier --check specs/001-marketplace-data-model docs/system-design/marketplace-v2
pnpm run ci
```

Expected: Prettier reports no issues, and `pnpm run ci` passes. If `pnpm run ci` fails, the feature is not done.
