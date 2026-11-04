// SC-003, FR-005: after any mix of the three operations, every balance
// equals the sum of its entries, all balances sum to 0, and escrow holds
// exactly the paid deals. This runs on its own throwaway database: the
// schema tests commit unbalanced ledger rows to the shared one, so the
// global sums only hold on a database that only the operations write to.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildTypeOrmOptions } from '../../src/database/typeorm-options.js';
import {
  createCompany,
  createLot,
  type TestCompany,
} from '../schema/helpers.js';
import { loadMigrations } from '../setup/migrations.js';
import type { BootedApp } from './helpers.js';

const databaseName = `reconciliation_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const sharedUrl = inject('databaseUrl');
let admin: DataSource;
let booted: BootedApp;
let db: DataSource;
let headers: typeof import('./helpers.js');

beforeAll(async () => {
  admin = await new DataSource(buildTypeOrmOptions(sharedUrl)).initialize();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(sharedUrl);
  url.pathname = `/${databaseName}`;
  const migrator = await new DataSource({
    ...buildTypeOrmOptions(url.toString()),
    migrations: loadMigrations(),
  }).initialize();
  await migrator.runMigrations({ transaction: 'all' });
  await migrator.destroy();

  // ConfigModule reads the environment when AppModule is first imported, so
  // the app is imported only after DATABASE_URL points at this database.
  process.env.DATABASE_URL = url.toString();
  headers = await import('./helpers.js');
  booted = await headers.bootApp();
  db = booted.db;
});

afterAll(async () => {
  await booted?.app.close();
  process.env.DATABASE_URL = sharedUrl;
  await admin?.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin?.destroy();
});

async function expectLedgerReconciled(step: string): Promise<void> {
  const mismatched = await db.query<{ id: string }[]>(
    `SELECT a.id FROM accounts a
     LEFT JOIN ledger_entries e ON e.account_id = a.id
     GROUP BY a.id, a.balance_minor
     HAVING a.balance_minor <> COALESCE(SUM(e.amount_minor), 0)`,
  );
  expect({ step, mismatched }).toEqual({ step, mismatched: [] });
  const totals = await db.query<{ total: string; escrow_gap: string }[]>(
    `SELECT (SELECT SUM(balance_minor) FROM accounts) AS total,
            (SELECT balance_minor FROM accounts WHERE type = 'escrow')
              - (SELECT COALESCE(SUM(total_minor), 0) FROM deals
                 WHERE status IN ('paid', 'shipped', 'disputed')) AS escrow_gap`,
  );
  expect({ step, ...totals[0] }).toEqual({
    step,
    total: '0',
    escrow_gap: '0',
  });
}

function server() {
  return booted.app.getHttpServer();
}

function topUp(company: TestCompany, amountMinor: number, invoiceId?: string) {
  return request(server())
    .post('/top-ups')
    .set(headers.operatorHeaders())
    .send({
      companyId: company.id,
      amountMinor,
      bankReference: `REC-${randomUUID().slice(0, 13)}`.toUpperCase(),
      transferDate: new Date().toISOString().slice(0, 10),
      ...(invoiceId === undefined ? {} : { invoiceId }),
    });
}

function buy(
  buyer: TestCompany,
  lotId: string,
  quantity: number,
  payNow = false,
) {
  return request(server())
    .post('/deals')
    .set(headers.companyHeaders(buyer.id))
    .set('Idempotency-Key', randomUUID())
    .send({ lotId, quantity, payNow });
}

function invoiceIdOf(response: request.Response): string {
  return (response.body as { invoice: { id: string } }).invoice.id;
}

describe('ledger reconciliation over a mix of operations', () => {
  it('keeps every balance, the zero sum and escrow consistent after each step', async () => {
    const [{ name }] = await db.query<{ name: string }[]>(
      'SELECT current_database() AS name',
    );
    expect(name).toBe(databaseName);
    const seller = await createCompany(db);
    const [first, second, third] = await Promise.all([
      createCompany(db),
      createCompany(db),
      createCompany(db),
    ]);
    const lotId = await createLot(db, seller.id, { stockAvailable: 50 });
    await expectLedgerReconciled('start');

    expect((await topUp(first, 500_000)).status).toBe(201);
    await expectLedgerReconciled('top-up without invoice');

    const later = await buy(first, lotId, 2);
    expect(later.status).toBe(201);
    await expectLedgerReconciled('purchase paid later');

    const paying = await topUp(first, 200_000, invoiceIdOf(later));
    expect((paying.body as { paidInvoiceId: string }).paidInvoiceId).toBe(
      invoiceIdOf(later),
    );
    await expectLedgerReconciled('top-up that pays an invoice');

    expect((await topUp(second, 100_000)).status).toBe(201);
    expect((await buy(second, lotId, 1, true)).status).toBe(201);
    await expectLedgerReconciled('purchase paid at once');

    expect((await buy(second, lotId, 1, true)).status).toBe(422);
    await expectLedgerReconciled('purchase rejected for balance');

    const uncovered = await buy(third, lotId, 3);
    const short = await topUp(third, 100_000, invoiceIdOf(uncovered));
    expect((short.body as { paidInvoiceId: null }).paidInvoiceId).toBeNull();
    await expectLedgerReconciled('top-up that does not cover its invoice');

    for (const unitPriceMinor of [120_000, 90_000]) {
      const change = await request(server())
        .post(`/lots/${lotId}/price-changes`)
        .set(headers.companyHeaders(seller.id))
        .send({ unitPriceMinor });
      expect(change.status).toBe(201);
    }
    await expectLedgerReconciled('price changes');

    const parallel = await Promise.all(
      Array.from({ length: 5 }, () => buy(first, lotId, 2, true)),
    );
    // 500,000 left; each purchase costs 180,000, so exactly 2 succeed.
    expect(parallel.filter((r) => r.status === 201)).toHaveLength(2);
    await expectLedgerReconciled('parallel purchases paid at once');
  });
});
