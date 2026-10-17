# Quickstart: Validate the Marketplace Schema

How to check by hand that the feature works, plus the automated checks. The rules and their names are in [contracts/schema-rules.md](./contracts/schema-rules.md), and the mapping is in [data-model.md](./data-model.md).

## Prerequisites

- Docker running (local database and Testcontainers).
- `pnpm install` done, and `.env` copied from `.env.example`.

## 1. Apply the migrations locally

```bash
pnpm run docker:up
pnpm run migration:run
```

Expected: five migrations run in this order: `CreateCompaniesAndAccounts`, `CreatePlatformSettings`, `CreateCatalog`, `CreateDeals`, `CreateLedger`.

```bash
docker compose exec postgres psql -U johndoe -d mydb -c '\dt'
docker compose exec postgres psql -U johndoe -d mydb -c 'SELECT type, company_id, balance_minor FROM accounts'
docker compose exec postgres psql -U johndoe -d mydb -c 'SELECT * FROM platform_settings'
```

Expected: 13 tables plus `migrations`; one `escrow` and one `bank_clearing` row with balance 0; one settings row with 5, 1, 3, 2, 30, 14.

## 2. Watch a rule reject bad data

An unbalanced transfer is rejected at commit by `ledger_transfers_balanced`:

```bash
docker compose exec postgres psql -U johndoe -d mydb <<'SQL'
BEGIN;
INSERT INTO companies (name, registration_number, email) VALUES ('Acme', 'QS-1', 'qs@acme.test');
INSERT INTO accounts (type, company_id) SELECT 'company_wallet', id FROM companies WHERE registration_number = 'QS-1';
INSERT INTO corrections (company_id, amount_minor, reason, operator_ref, idempotency_key)
  SELECT id, 100, 'quickstart', 'op-1', gen_random_uuid() FROM companies WHERE registration_number = 'QS-1';
WITH t AS (
  INSERT INTO ledger_transfers (type, correction_id, actor_type, actor_ref, entry_count)
  SELECT 'correction', id, 'operator', 'op-1', 2 FROM corrections WHERE reason = 'quickstart' RETURNING id
)
INSERT INTO ledger_entries (transfer_id, account_id, amount_minor, balance_after_minor)
SELECT t.id, a.id, 100, 100 FROM t, accounts a JOIN companies c ON c.id = a.company_id WHERE c.registration_number = 'QS-1';
COMMIT;
SQL
```

Expected: `COMMIT` fails with an error from `ledger_transfers_balanced`, and none of the rows exist afterwards.

Two more checks:

- `UPDATE accounts SET type = 'escrow' WHERE type = 'bank_clearing';` fails with `accounts_identity_immutable`.
- `DELETE FROM accounts WHERE type = 'escrow';` fails with the same rule.

## 3. Check for drift

```bash
pnpm run migration:check
```

Expected: `No changes in database schema were found`. Then add a column to any entity without a migration and run it again. Expected: it fails and prints the missing `ALTER TABLE`. Undo the change.

## 4. Revert and apply again

```bash
for i in 1 2 3 4 5; do pnpm run migration:revert; done
docker compose exec postgres psql -U johndoe -d mydb -c '\dt'
pnpm run migration:run
```

Expected: after five reverts only `migrations` is left, and no functions, triggers or the `invoice_number_seq` sequence remain (`\df`, `\ds`). The second `migration:run` gives the same result as step 1.

## 5. Automated checks

```bash
pnpm exec vitest run src/database                                    # transformer and entity metadata
pnpm run build && pnpm exec vitest run --config ./vitest.config.e2e.ts test/schema   # rule, round-trip, drift tests
pnpm run ci                                                          # definition of done
```

Expected: all pass. `test/schema/drift.e2e-spec.ts` prints the SQL the entities would add if it fails. `test/schema/migrations.e2e-spec.ts` runs apply, revert and apply on its own throwaway database.

## 6. Documentation

- `cmp specs/001-marketplace-data-model/erd.drawio.svg docs/system-design/marketplace-v2/erd.drawio.svg` prints nothing.
- `cmp specs/001-marketplace-data-model/erd.drawio.svg docs/architecture/erd.drawio.svg` prints nothing.
- `git diff main -- docs/system-design/marketplace-v1` is empty.
- The README Architecture section shows the ERD.
