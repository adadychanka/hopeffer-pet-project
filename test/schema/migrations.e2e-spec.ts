// Story 1: the migrations build the whole schema on an empty database, revert
// cleanly, and build the same schema again. This runs on its own throwaway
// database, because reverting the shared one would break the test files
// that run in parallel.
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildTypeOrmOptions } from '../../src/database/typeorm-options.js';
import { loadMigrations } from '../setup/migrations.js';

const TABLES = [
  'accounts',
  'companies',
  'corrections',
  'deal_status_changes',
  'deals',
  'invoices',
  'ledger_entries',
  'ledger_transfers',
  'lot_photos',
  'lot_price_changes',
  'lots',
  'migrations',
  'platform_settings',
  'top_ups',
];

type Row = Record<string, unknown>;

// Everything in schema public that a migration can create, in a stable order.
async function snapshot(db: DataSource) {
  const rows = (sql: string) => db.query<Row[]>(sql);
  return {
    tables: await rows(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY 1`,
    ),
    columns: await rows(
      `SELECT table_name, column_name, data_type, is_nullable, column_default,
              is_identity, identity_generation
       FROM information_schema.columns
       WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    ),
    constraints: await rows(
      `SELECT conrelid::regclass::text AS table_name, conname,
              pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace
       ORDER BY 1, 2`,
    ),
    indexes: await rows(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' ORDER BY 1, 2`,
    ),
    triggers: await rows(
      `SELECT tgrelid::regclass::text AS table_name, tgname,
              pg_get_triggerdef(oid) AS definition
       FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`,
    ),
    functions: await rows(
      `SELECT proname, pg_get_functiondef(oid) AS definition
       FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1`,
    ),
    sequences: await rows(
      `SELECT sequence_name FROM information_schema.sequences
       WHERE sequence_schema = 'public' ORDER BY 1`,
    ),
  };
}

async function appliedMigrations(db: DataSource): Promise<number> {
  const rows = await db.query<{ count: number }[]>(
    'SELECT count(*)::int AS count FROM migrations',
  );
  return rows[0].count;
}

describe('migrations (throwaway database)', () => {
  const databaseName = `schema_roundtrip_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let admin: DataSource;
  let db: DataSource;
  let firstSnapshot: Awaited<ReturnType<typeof snapshot>>;

  beforeAll(async () => {
    const sharedUrl = inject('databaseUrl');
    admin = await new DataSource(buildTypeOrmOptions(sharedUrl)).initialize();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(sharedUrl);
    url.pathname = `/${databaseName}`;
    db = await new DataSource({
      ...buildTypeOrmOptions(url.toString()),
      migrations: loadMigrations(),
    }).initialize();
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin?.destroy();
  });

  it('creates every table and the seed rows on an empty database', async () => {
    await db.runMigrations({ transaction: 'all' });

    const tables = await db.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY 1`,
    );
    expect(tables.map((row) => row.table_name)).toEqual(TABLES);

    expect(
      await db.query(
        'SELECT type, company_id, balance_minor FROM accounts ORDER BY type',
      ),
    ).toEqual([
      { type: 'bank_clearing', company_id: null, balance_minor: '0' },
      { type: 'escrow', company_id: null, balance_minor: '0' },
    ]);

    expect(
      await db.query(
        `SELECT id, payment_window_days, grace_period_days, max_unpaid_deals,
                expiry_limit, expiry_lookback_days, confirmation_window_days,
                updated_by_ref
         FROM platform_settings`,
      ),
    ).toEqual([
      {
        id: 1,
        payment_window_days: 5,
        grace_period_days: 1,
        max_unpaid_deals: 3,
        expiry_limit: 2,
        expiry_lookback_days: 30,
        confirmation_window_days: 14,
        updated_by_ref: null,
      },
    ]);

    firstSnapshot = await snapshot(db);
  });

  it('pads invoice numbers to at least 6 digits and never cuts a longer one', async () => {
    await db.query("SELECT setval('invoice_number_seq', 999999)");
    const rows = await db.query<{ number: string }[]>(
      'SELECT next_invoice_number() AS number',
    );
    expect(rows[0].number).toMatch(/^INV-\d{4}-1000000$/);
  });

  it('reverts every migration and leaves nothing of the feature behind', async () => {
    while ((await appliedMigrations(db)) > 0) {
      await db.undoLastMigration({ transaction: 'all' });
    }

    const after = await snapshot(db);
    expect(after.tables).toEqual([{ table_name: 'migrations' }]);
    expect(after.functions).toEqual([]);
    expect(after.triggers).toEqual([]);
    expect(after.sequences).toEqual([{ sequence_name: 'migrations_id_seq' }]);
    expect(after.indexes.map((row) => row.tablename)).toEqual(['migrations']);
  });

  it('builds the same schema when applied again', async () => {
    await db.runMigrations({ transaction: 'all' });
    expect(await snapshot(db)).toEqual(firstSnapshot);
  });
});
