// Shared pieces of the schema tests: a database connection built like the
// app's, rule assertions, and raw-SQL fixtures. Schema tests are database
// tests, so they open a DataSource instead of booting AppModule
// (constitution, Principle II). Every fixture writes random unique values,
// because all test files share one database.
import { randomUUID } from 'node:crypto';
import type { DatabaseError } from 'pg';
import { DataSource, type EntityManager, QueryFailedError } from 'typeorm';
import { expect, inject } from 'vitest';
import { buildTypeOrmOptions } from '../../src/database/typeorm-options.js';
import { entityClasses } from '../setup/entity-classes.js';

export { entityClasses };

// Anything that runs SQL: a DataSource, an EntityManager or a QueryRunner.
export interface Queryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export function openTestDataSource(): Promise<DataSource> {
  return new DataSource({
    ...buildTypeOrmOptions(inject('databaseUrl')),
    entities: entityClasses(),
  }).initialize();
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

// Asserts that the database rejected the write with the named rule: a
// constraint, or a trigger that raises with that name.
export async function expectRule(
  promise: Promise<unknown>,
  rule: string,
): Promise<void> {
  const error = await failureOf(promise);
  expect(error, `expected rule ${rule} to reject the write`).toBeInstanceOf(
    QueryFailedError,
  );
  expect(
    (error as QueryFailedError<DatabaseError>).driverError.constraint,
  ).toBe(rule);
}

// NOT NULL violations carry no constraint name, only the column.
export async function expectNotNull(
  promise: Promise<unknown>,
  column: string,
): Promise<void> {
  const error = await failureOf(promise);
  expect(error, `expected ${column} to be required`).toBeInstanceOf(
    QueryFailedError,
  );
  const driverError = (error as QueryFailedError<DatabaseError>).driverError;
  expect(driverError.code).toBe('23502');
  expect(driverError.column).toBe(column);
}

export function unique(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function insertReturningId(
  db: Queryable,
  sql: string,
  parameters: unknown[],
): Promise<string> {
  const rows = (await db.query(sql, parameters)) as { id: string }[];
  return rows[0].id;
}

export interface TestCompany {
  id: string;
  walletId: string | null;
}

export async function createCompany(
  db: Queryable,
  { wallet = true }: { wallet?: boolean } = {},
): Promise<TestCompany> {
  const id = await insertReturningId(
    db,
    `INSERT INTO companies (name, registration_number, email)
     VALUES ('Test company', $1, $2) RETURNING id`,
    [unique('REG'), `${unique('company')}@test.example`],
  );
  const walletId = wallet ? await createWallet(db, id) : null;
  return { id, walletId };
}

export function createWallet(
  db: Queryable,
  companyId: string,
): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO accounts (type, company_id) VALUES ('company_wallet', $1) RETURNING id`,
    [companyId],
  );
}

export async function platformAccountId(
  db: Queryable,
  type: 'escrow' | 'bank_clearing',
): Promise<string> {
  const rows = (await db.query('SELECT id FROM accounts WHERE type = $1', [
    type,
  ])) as { id: string }[];
  return rows[0].id;
}

export interface LotFixture {
  unitPriceMinor?: number;
  stockAvailable?: number;
  status?: 'hidden' | 'published';
}

export function createLot(
  db: Queryable,
  sellerId: string,
  {
    unitPriceMinor = 100_000,
    stockAvailable = 5,
    status = 'published',
  }: LotFixture = {},
): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO lots (seller_company_id, title, unit_price_minor, stock_available, status)
     VALUES ($1, 'Test lot', $2, $3, $4) RETURNING id`,
    [sellerId, unitPriceMinor, stockAvailable, status],
  );
}

export interface DealFixture {
  buyerId: string;
  sellerId: string;
  lotId: string;
  quantity?: number;
  unitPriceMinor?: number;
  status?: string;
  confirmationDueAt?: Date | null;
  idempotencyKey?: string;
}

export function createDeal(
  db: Queryable,
  {
    buyerId,
    sellerId,
    lotId,
    quantity = 1,
    unitPriceMinor = 100_000,
    status = 'awaiting_payment',
    confirmationDueAt = null,
    idempotencyKey = randomUUID(),
  }: DealFixture,
): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO deals (lot_id, buyer_company_id, seller_company_id, quantity,
       unit_price_minor, total_minor, status, confirmation_due_at, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      lotId,
      buyerId,
      sellerId,
      quantity,
      unitPriceMinor,
      quantity * unitPriceMinor,
      status,
      confirmationDueAt,
      idempotencyKey,
    ],
  );
}

// A buyer and a seller with wallets, a published lot of the seller, and an
// unpaid deal for one unit.
export async function createDealSetup(db: Queryable) {
  const buyer = await createCompany(db);
  const seller = await createCompany(db);
  const lotId = await createLot(db, seller.id);
  const dealId = await createDeal(db, {
    buyerId: buyer.id,
    sellerId: seller.id,
    lotId,
  });
  return { buyer, seller, lotId, dealId };
}

export interface InvoiceFixture {
  amountMinor?: number;
  status?: string;
  paidAt?: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createInvoice(
  db: Queryable,
  dealId: string,
  {
    amountMinor = 100_000,
    status = 'issued',
    paidAt = null,
  }: InvoiceFixture = {},
): Promise<string> {
  const issuedAt = new Date();
  return insertReturningId(
    db,
    `INSERT INTO invoices (deal_id, amount_minor, status, issued_at, due_at, expires_at, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      dealId,
      amountMinor,
      status,
      issuedAt,
      new Date(issuedAt.getTime() + 5 * DAY_MS),
      new Date(issuedAt.getTime() + 6 * DAY_MS),
      paidAt,
    ],
  );
}

export interface TopUpFixture {
  amountMinor?: number;
  bankReference?: string;
  invoiceId?: string | null;
}

export function createTopUp(
  db: Queryable,
  companyId: string,
  {
    amountMinor = 100_000,
    bankReference = unique('TRX').toUpperCase(),
    invoiceId = null,
  }: TopUpFixture = {},
): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO top_ups (company_id, amount_minor, bank_reference, transfer_date, invoice_id, operator_ref)
     VALUES ($1, $2, $3, CURRENT_DATE, $4, 'operator-1') RETURNING id`,
    [companyId, amountMinor, bankReference, invoiceId],
  );
}

export interface CorrectionFixture {
  amountMinor?: number;
  reason?: string;
  topUpId?: string | null;
  idempotencyKey?: string;
}

export function createCorrection(
  db: Queryable,
  companyId: string,
  {
    amountMinor = 100,
    reason = 'Test correction',
    topUpId = null,
    idempotencyKey = randomUUID(),
  }: CorrectionFixture = {},
): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO corrections (company_id, amount_minor, reason, top_up_id, operator_ref, idempotency_key)
     VALUES ($1, $2, $3, $4, 'operator-1', $5) RETURNING id`,
    [companyId, amountMinor, reason, topUpId, idempotencyKey],
  );
}

export interface TransferSource {
  topUpId?: string;
  invoiceId?: string;
  dealId?: string;
  correctionId?: string;
}

export interface TransferFixture {
  type: 'top_up' | 'invoice_payment' | 'payout' | 'refund' | 'correction';
  source: TransferSource;
  actor?: {
    type: 'buyer' | 'seller' | 'operator' | 'system';
    ref: string | null;
  };
  entries: { accountId: string; amountMinor: number }[];
  // The entry count the transfer declares. Defaults to entries.length.
  entryCount?: number;
}

// Inserts a transfer and its entries without committing. The zero-sum check
// runs when the caller's transaction commits.
export async function writeTransfer(
  db: Queryable,
  {
    type,
    source,
    actor = { type: 'operator', ref: 'operator-1' },
    entries,
    entryCount = entries.length,
  }: TransferFixture,
): Promise<string> {
  const transferId = await insertReturningId(
    db,
    `INSERT INTO ledger_transfers (type, top_up_id, invoice_id, deal_id, correction_id, actor_type, actor_ref, entry_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      type,
      source.topUpId ?? null,
      source.invoiceId ?? null,
      source.dealId ?? null,
      source.correctionId ?? null,
      actor.type,
      actor.ref,
      entryCount,
    ],
  );
  for (const entry of entries) {
    await db.query(
      `INSERT INTO ledger_entries (transfer_id, account_id, amount_minor, balance_after_minor)
       VALUES ($1, $2, $3, $3)`,
      [transferId, entry.accountId, entry.amountMinor],
    );
  }
  return transferId;
}

// INSERT of one row from a column-to-value map, returning the stored row.
// Table and column names come from the test code, never from input.
export async function insertRow(
  db: Queryable,
  table: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const rows = (await db.query(
    `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING *`,
    Object.values(values),
  )) as Record<string, unknown>[];
  return rows[0];
}

// For each required column, an insert that sets it to NULL must fail with a
// NOT NULL violation on that column.
export async function expectRequiredColumns(
  db: Queryable,
  table: string,
  validRow: () => Promise<Record<string, unknown>>,
  columns: string[],
): Promise<void> {
  for (const column of columns) {
    const row = await validRow();
    await expectNotNull(
      insertRow(db, table, { ...row, [column]: null }),
      column,
    );
  }
}

// Runs work in a transaction that is always rolled back, for tests that
// touch shared rows (the platform accounts, the settings row).
export async function rolledBack<T>(
  dataSource: DataSource,
  work: (db: Queryable) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.startTransaction();
  try {
    return await work(queryRunner);
  } finally {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  }
}

// For a rule that backs up another one: PostgreSQL tests CHECK constraints in
// alphabetical order of their names, so a redundant rule may never be the one
// reported. The write must still be rejected by one of the given rules.
export async function expectOneOfRules(
  promise: Promise<unknown>,
  rules: string[],
): Promise<void> {
  const error = await failureOf(promise);
  expect(error, `expected one of ${rules.join(', ')}`).toBeInstanceOf(
    QueryFailedError,
  );
  expect(rules).toContain(
    (error as QueryFailedError<DatabaseError>).driverError.constraint,
  );
}

// Like rolledBack(), for work through repositories: the entity manager of a
// transaction that is always rolled back.
export async function rolledBackManager<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.startTransaction();
  try {
    return await work(queryRunner.manager);
  } finally {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  }
}
