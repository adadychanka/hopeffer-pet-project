# Quickstart: Marketplace Operations

How to prove the feature works. The contract is in [contracts/http-api.md](./contracts/http-api.md); what each operation writes is in [data-model.md](./data-model.md).

## Prerequisites

- Node 24, pnpm 12 (`pnpm install`).
- Docker running: the e2e tests start their own Postgres, Redis, RustFS and OpenSearch containers.

## Automated validation

```bash
pnpm run test:e2e        # all e2e tests, including test/operations/
pnpm run test:e2e test/operations/purchase.e2e-spec.ts   # one operation
pnpm run test:cov        # unit + e2e under coverage, 98% thresholds
pnpm run ci              # definition of done
```

| Spec item                    | Proved by                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| User Story 1, FR-016–FR-022  | `test/operations/purchase.e2e-spec.ts`                                                                                        |
| User Story 2, FR-006–FR-010a | `test/operations/top-up.e2e-spec.ts`                                                                                          |
| User Story 3, FR-011–FR-015  | `test/operations/price-change.e2e-spec.ts`                                                                                    |
| SC-001, SC-002, SC-005       | the "at the same time" tests in `purchase.e2e-spec.ts`                                                                        |
| SC-003                       | `test/operations/reconciliation.e2e-spec.ts` (global sums, own database) and `expectWalletConsistent()` after each money test |
| SC-004                       | the bank reference tests in `top-up.e2e-spec.ts`                                                                              |
| SC-008                       | one test per error code of the contract                                                                                       |

## Manual run

The feature has no endpoints to create companies, wallets or lots (spec Clarifications), so insert them by SQL first.

1. Start the services and the app:

   ```bash
   pnpm run docker:up
   pnpm run migration:run
   pnpm run start:dev
   ```

2. Create a seller and a buyer with wallets, and a published lot (price 1,000.00, stock 5):

   ```bash
   docker compose exec -T postgres psql -U johndoe -d mydb <<'SQL'
   WITH s AS (INSERT INTO companies (name, registration_number, email)
              VALUES ('Seller', 'REG-S', 'seller@example.test') RETURNING id),
        b AS (INSERT INTO companies (name, registration_number, email)
              VALUES ('Buyer', 'REG-B', 'buyer@example.test') RETURNING id),
        w AS (INSERT INTO accounts (type, company_id)
              SELECT 'company_wallet', id FROM s UNION ALL
              SELECT 'company_wallet', id FROM b RETURNING company_id)
   SELECT (SELECT id FROM s) AS seller_id, (SELECT id FROM b) AS buyer_id;
   SQL
   ```

   Then insert the lot for `seller_id` (`INSERT INTO lots (seller_company_id, title, unit_price_minor, stock_available, status) VALUES (…, 'Drill', 100000, 5, 'published')`).

3. Buy 3 units without paying:

   ```bash
   curl -si localhost:3000/deals \
     -H 'Content-Type: application/json' \
     -H 'X-Actor-Role: company' -H 'X-Actor-Ref: buyer-person-1' \
     -H "X-Company-Id: $BUYER_ID" -H "Idempotency-Key: $(uuidgen)" \
     -d "{\"lotId\":\"$LOT_ID\",\"quantity\":3}"
   ```

   Expect `201`, deal `awaiting_payment`, total `300000`, invoice `issued`. Send the same request with the same key again: `200` and `Idempotent-Replayed: true`.

4. Record a top-up that pays the invoice:

   ```bash
   curl -si localhost:3000/top-ups \
     -H 'Content-Type: application/json' \
     -H 'X-Actor-Role: operator' -H 'X-Actor-Ref: operator-1' \
     -d "{\"companyId\":\"$BUYER_ID\",\"amountMinor\":300000,\"bankReference\":\"trx 1\",\"transferDate\":\"$(date -u +%F)\",\"invoiceId\":\"$INVOICE_ID\"}"
   ```

   Expect `201`, `walletBalanceMinor: 0`, `paidInvoiceId` set. The same request again: `409 bank_reference_already_recorded`.

5. Change the price as the seller:

   ```bash
   curl -si localhost:3000/lots/$LOT_ID/price-changes \
     -H 'Content-Type: application/json' \
     -H 'X-Actor-Role: company' -H 'X-Actor-Ref: seller-person-1' \
     -H "X-Company-Id: $SELLER_ID" \
     -d '{"unitPriceMinor":120000}'
   ```

   Expect `201` with `oldPriceMinor: 100000`. The deal from step 3 still has `unitPriceMinor: 100000`.

6. Check the ledger is consistent (every query returns no row or 0): run the three reconciliation queries of [feature 001 data-model.md](../001-marketplace-data-model/data-model.md#invariants-and-where-they-are-enforced).
