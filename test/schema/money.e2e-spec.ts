// Story 3: the database protects the money. Accounts, top-ups, corrections
// and the ledger reject bad data, and a transfer whose entries do not sum to 0
// is never committed.
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createCorrection,
  createDealSetup,
  createInvoice,
  createTopUp,
  createWallet,
  expectOneOfRules,
  expectRequiredColumns,
  expectRule,
  insertRow,
  openTestDataSource,
  platformAccountId,
  rolledBack,
  unique,
  writeTransfer,
  type Queryable,
} from './helpers.js';

let db: DataSource;
let escrowId: string;
let bankClearingId: string;

beforeAll(async () => {
  db = await openTestDataSource();
  escrowId = await platformAccountId(db, 'escrow');
  bankClearingId = await platformAccountId(db, 'bank_clearing');
});

afterAll(async () => {
  await db.destroy();
});

// A company with a wallet and a correction that a transfer can point to.
async function correctionSource(): Promise<{
  walletId: string;
  correctionId: string;
}> {
  const company = await createCompany(db);
  const correctionId = await createCorrection(db, company.id);
  return { walletId: company.walletId as string, correctionId };
}

// A balanced correction transfer: bank clearing to the wallet.
async function balancedCorrection(
  tx: Queryable,
  { walletId, correctionId }: { walletId: string; correctionId: string },
  amountMinor = 100,
): Promise<string> {
  return writeTransfer(tx, {
    type: 'correction',
    source: { correctionId },
    entries: [
      { accountId: bankClearingId, amountMinor: -amountMinor },
      { accountId: walletId, amountMinor },
    ],
  });
}

async function committedCorrection(): Promise<{
  transferId: string;
  walletId: string;
}> {
  const source = await correctionSource();
  const transferId = await db.transaction((tx) =>
    balancedCorrection(tx, source),
  );
  return { transferId, walletId: source.walletId };
}

describe('accounts', () => {
  it('has exactly one escrow and one bank clearing account, without a company', async () => {
    expect(
      await db.query(
        `SELECT type, company_id FROM accounts
         WHERE type <> 'company_wallet' ORDER BY type`,
      ),
    ).toEqual([
      { type: 'bank_clearing', company_id: null },
      { type: 'escrow', company_id: null },
    ]);
  });

  it('stores a company wallet with balance 0', async () => {
    const company = await createCompany(db, { wallet: false });
    await expect(
      insertRow(db, 'accounts', {
        type: 'company_wallet',
        company_id: company.id,
      }),
    ).resolves.toMatchObject({ balance_minor: '0' });
  });

  it('rejects an unknown account type', async () => {
    await expectRule(
      insertRow(db, 'accounts', { type: 'savings' }),
      'accounts_type_check',
    );
  });

  it('rejects a wallet without a company, and a platform account with one', async () => {
    await expectRule(
      insertRow(db, 'accounts', { type: 'company_wallet' }),
      'accounts_company_matches_type',
    );
    const company = await createCompany(db, { wallet: false });
    await expectRule(
      insertRow(db, 'accounts', { type: 'escrow', company_id: company.id }),
      'accounts_company_matches_type',
    );
  });

  it('rejects a second wallet for the same company', async () => {
    const company = await createCompany(db);
    await expectRule(createWallet(db, company.id), 'accounts_company_id_key');
  });

  it('rejects a third platform account', async () => {
    await expectRule(
      insertRow(db, 'accounts', { type: 'escrow' }),
      'accounts_platform_type_key',
    );
  });

  it('keeps a wallet and the escrow at 0 or above (Story 3 scenario 8)', async () => {
    const company = await createCompany(db);
    await expectRule(
      db.query('UPDATE accounts SET balance_minor = -1 WHERE id = $1', [
        company.walletId,
      ]),
      'accounts_balance_not_negative',
    );
    await expectRule(
      rolledBack(db, (tx) =>
        tx.query('UPDATE accounts SET balance_minor = -1 WHERE id = $1', [
          escrowId,
        ]),
      ),
      'accounts_balance_not_negative',
    );
  });

  it('keeps bank clearing at 0 or below (Story 3 scenario 8)', async () => {
    await expectRule(
      rolledBack(db, (tx) =>
        tx.query('UPDATE accounts SET balance_minor = 1 WHERE id = $1', [
          bankClearingId,
        ]),
      ),
      'accounts_bank_clearing_not_positive',
    );
    await expect(
      rolledBack(db, (tx) =>
        tx.query('UPDATE accounts SET balance_minor = -500 WHERE id = $1', [
          bankClearingId,
        ]),
      ),
    ).resolves.toBeDefined();
  });

  it('never deletes an account or changes its type or company', async () => {
    const company = await createCompany(db);
    const other = await createCompany(db, { wallet: false });
    await expectRule(
      db.query('DELETE FROM accounts WHERE id = $1', [escrowId]),
      'accounts_identity_immutable',
    );
    await expectRule(
      db.query("UPDATE accounts SET type = 'escrow' WHERE id = $1", [
        bankClearingId,
      ]),
      'accounts_identity_immutable',
    );
    await expectRule(
      db.query('UPDATE accounts SET company_id = $1 WHERE id = $2', [
        other.id,
        company.walletId,
      ]),
      'accounts_identity_immutable',
    );
  });

  it('changes the balance of a wallet', async () => {
    const company = await createCompany(db);
    expect(
      await db.query(
        'UPDATE accounts SET balance_minor = 500 WHERE id = $1 RETURNING balance_minor',
        [company.walletId],
      ),
    ).toEqual([[{ balance_minor: '500' }], 1]);
  });

  it('keeps a company with a wallet from being deleted', async () => {
    const company = await createCompany(db);
    await expectRule(
      db.query('DELETE FROM companies WHERE id = $1', [company.id]),
      'accounts_company_id_fkey',
    );
  });

  it('requires the type, the balance and the creation time', async () => {
    await expectRequiredColumns(
      db,
      'accounts',
      async () => ({
        type: 'company_wallet',
        company_id: (await createCompany(db, { wallet: false })).id,
      }),
      ['type', 'balance_minor', 'created_at'],
    );
  });
});

describe('top_ups', () => {
  const topUpRow = async () => ({
    company_id: (await createCompany(db)).id,
    amount_minor: 300_000,
    bank_reference: unique('TRX').toUpperCase(),
    transfer_date: '2026-03-01',
    operator_ref: 'operator-1',
  });

  it('stores a valid top-up', async () => {
    await expect(
      insertRow(db, 'top_ups', await topUpRow()),
    ).resolves.toMatchObject({ amount_minor: '300000', invoice_id: null });
  });

  it('records one bank notification once (Story 3 scenario 7)', async () => {
    const row = await topUpRow();
    await insertRow(db, 'top_ups', row);
    await expectRule(
      insertRow(db, 'top_ups', {
        ...(await topUpRow()),
        bank_reference: row.bank_reference,
      }),
      'top_ups_bank_reference_key',
    );
  });

  it.each([' TRX-1', 'trx-1', ''])(
    'stores only a normalized bank reference, rejecting %j',
    async (bank_reference) => {
      await expectRule(
        insertRow(db, 'top_ups', { ...(await topUpRow()), bank_reference }),
        'top_ups_bank_reference_normalized',
      );
    },
  );

  it('rejects an amount of 0', async () => {
    await expectRule(
      insertRow(db, 'top_ups', { ...(await topUpRow()), amount_minor: 0 }),
      'top_ups_amount_positive',
    );
  });

  it('needs the company wallet', async () => {
    const company = await createCompany(db, { wallet: false });
    await expectRule(
      insertRow(db, 'top_ups', {
        ...(await topUpRow()),
        company_id: company.id,
      }),
      'top_ups_company_id_fkey',
    );
  });

  it('names only an existing invoice', async () => {
    await expectRule(
      insertRow(db, 'top_ups', {
        ...(await topUpRow()),
        invoice_id: randomUUID(),
      }),
      'top_ups_invoice_id_fkey',
    );
  });

  it('requires every column except the invoice', async () => {
    await expectRequiredColumns(db, 'top_ups', topUpRow, [
      'company_id',
      'amount_minor',
      'bank_reference',
      'transfer_date',
      'operator_ref',
      'recorded_at',
    ]);
  });
});

describe('corrections', () => {
  const correctionRow = async () => ({
    company_id: (await createCompany(db)).id,
    amount_minor: -2_500,
    reason: 'Wrong amount recorded',
    operator_ref: 'operator-1',
    idempotency_key: randomUUID(),
  });

  it('stores a valid correction', async () => {
    await expect(
      insertRow(db, 'corrections', await correctionRow()),
    ).resolves.toMatchObject({ amount_minor: '-2500', top_up_id: null });
  });

  it('rejects an amount of 0', async () => {
    await expectRule(
      insertRow(db, 'corrections', {
        ...(await correctionRow()),
        amount_minor: 0,
      }),
      'corrections_amount_not_zero',
    );
  });

  it.each(['', 'x'.repeat(1001)])('rejects the reason %j', async (reason) => {
    await expectRule(
      insertRow(db, 'corrections', { ...(await correctionRow()), reason }),
      'corrections_reason_length',
    );
  });

  it('rejects a second correction with the same idempotency key (Story 3 scenario 9)', async () => {
    const row = await correctionRow();
    await insertRow(db, 'corrections', row);
    await expectRule(
      insertRow(db, 'corrections', {
        ...(await correctionRow()),
        idempotency_key: row.idempotency_key,
      }),
      'corrections_idempotency_key_key',
    );
  });

  it('needs the company wallet', async () => {
    const company = await createCompany(db, { wallet: false });
    await expectRule(
      insertRow(db, 'corrections', {
        ...(await correctionRow()),
        company_id: company.id,
      }),
      'corrections_company_id_fkey',
    );
  });

  it('names only an existing top-up', async () => {
    await expectRule(
      insertRow(db, 'corrections', {
        ...(await correctionRow()),
        top_up_id: randomUUID(),
      }),
      'corrections_top_up_id_fkey',
    );
  });

  it('requires every column except the top-up', async () => {
    await expectRequiredColumns(db, 'corrections', correctionRow, [
      'company_id',
      'amount_minor',
      'reason',
      'operator_ref',
      'idempotency_key',
      'created_at',
    ]);
  });
});

describe('ledger_transfers', () => {
  const transferRow = async () => ({
    type: 'correction',
    correction_id: (await correctionSource()).correctionId,
    actor_type: 'operator',
    actor_ref: 'operator-1',
  });

  it('rejects a transfer committed without entries', async () => {
    await expectRule(
      insertRow(db, 'ledger_transfers', await transferRow()),
      'ledger_transfers_balanced',
    );
  });

  it('rejects an unknown transfer type', async () => {
    // With an unknown type, no source matches it, so ledger_transfers_one_source
    // (tested first, by name) also fails.
    await expectOneOfRules(
      insertRow(db, 'ledger_transfers', {
        type: 'gift',
        actor_type: 'operator',
        actor_ref: 'operator-1',
      }),
      ['ledger_transfers_one_source', 'ledger_transfers_type_check'],
    );
  });

  it('rejects a transfer with two sources', async () => {
    const topUpId = await createTopUp(db, (await createCompany(db)).id);
    await expectRule(
      insertRow(db, 'ledger_transfers', {
        ...(await transferRow()),
        top_up_id: topUpId,
      }),
      'ledger_transfers_one_source',
    );
  });

  it('rejects a transfer with no source', async () => {
    await expectOneOfRules(
      insertRow(db, 'ledger_transfers', {
        ...(await transferRow()),
        correction_id: null,
      }),
      [
        'ledger_transfers_correction_matches_type',
        'ledger_transfers_one_source',
      ],
    );
  });

  it('rejects a payout that points to a top-up', async () => {
    const topUpId = await createTopUp(db, (await createCompany(db)).id);
    await expectRule(
      insertRow(db, 'ledger_transfers', {
        type: 'payout',
        top_up_id: topUpId,
        actor_type: 'system',
      }),
      'ledger_transfers_deal_matches_type',
    );
  });

  it('rejects a top-up transfer that points to an invoice', async () => {
    const { dealId } = await createDealSetup(db);
    const invoiceId = await createInvoice(db, dealId);
    await expectRule(
      insertRow(db, 'ledger_transfers', {
        type: 'top_up',
        invoice_id: invoiceId,
        actor_type: 'operator',
        actor_ref: 'operator-1',
      }),
      'ledger_transfers_invoice_matches_type',
    );
  });

  it('rejects a source that does not match the type', async () => {
    // Each type rule backs up the others: a top-up source on a correction
    // breaks two of them, and the first by name is reported.
    const topUpId = await createTopUp(db, (await createCompany(db)).id);
    await expectOneOfRules(
      insertRow(db, 'ledger_transfers', {
        type: 'correction',
        top_up_id: topUpId,
        actor_type: 'operator',
        actor_ref: 'operator-1',
      }),
      [
        'ledger_transfers_correction_matches_type',
        'ledger_transfers_top_up_matches_type',
      ],
    );
  });

  it('rejects an unknown actor type', async () => {
    await expectRule(
      insertRow(db, 'ledger_transfers', {
        ...(await transferRow()),
        actor_type: 'robot',
      }),
      'ledger_transfers_actor_type_check',
    );
  });

  it.each([
    ['system', 'job-1'],
    ['operator', null],
  ])('rejects actor %s with reference %j', async (actor_type, actor_ref) => {
    await expectRule(
      insertRow(db, 'ledger_transfers', {
        ...(await transferRow()),
        actor_type,
        actor_ref,
      }),
      'ledger_transfers_actor_ref_matches_type',
    );
  });

  it.each([
    ['top_up', 'top_up_id', 'ledger_transfers_top_up_id_fkey'],
    ['invoice_payment', 'invoice_id', 'ledger_transfers_invoice_id_fkey'],
    ['payout', 'deal_id', 'ledger_transfers_deal_id_fkey'],
    ['correction', 'correction_id', 'ledger_transfers_correction_id_fkey'],
  ])(
    'points a %s transfer only to an existing source',
    async (type, column, rule) => {
      await expectRule(
        insertRow(db, 'ledger_transfers', {
          type,
          [column]: randomUUID(),
          actor_type: 'system',
        }),
        rule,
      );
    },
  );

  it('writes one transfer per top-up', async () => {
    const company = await createCompany(db);
    const topUpId = await createTopUp(db, company.id);
    const topUp = (walletId: string) => (tx: Queryable) =>
      writeTransfer(tx, {
        type: 'top_up',
        source: { topUpId },
        entries: [
          { accountId: bankClearingId, amountMinor: -100_000 },
          { accountId: walletId, amountMinor: 100_000 },
        ],
      });
    await db.transaction(topUp(company.walletId as string));
    await expectRule(
      db.transaction(topUp(company.walletId as string)),
      'ledger_transfers_top_up_id_key',
    );
  });

  it('writes one transfer per correction', async () => {
    const source = await correctionSource();
    await db.transaction((tx) => balancedCorrection(tx, source));
    await expectRule(
      db.transaction((tx) => balancedCorrection(tx, source)),
      'ledger_transfers_correction_id_key',
    );
  });

  it('pays an invoice once (Story 3 scenario 4)', async () => {
    const { buyer, dealId } = await createDealSetup(db);
    const invoiceId = await createInvoice(db, dealId);
    const pay = (tx: Queryable) =>
      writeTransfer(tx, {
        type: 'invoice_payment',
        source: { invoiceId },
        actor: { type: 'buyer', ref: 'buyer-1' },
        entries: [
          { accountId: buyer.walletId as string, amountMinor: -100_000 },
          { accountId: escrowId, amountMinor: 100_000 },
        ],
      });
    await db.transaction(pay);
    await expectRule(
      db.transaction(pay),
      'ledger_transfers_invoice_payment_key',
    );
  });

  it('settles a deal once: no refund after a payout (Story 3 scenario 5)', async () => {
    const { buyer, seller, dealId } = await createDealSetup(db);
    const settle =
      (type: 'payout' | 'refund', walletId: string) => (tx: Queryable) =>
        writeTransfer(tx, {
          type,
          source: { dealId },
          actor: { type: 'system', ref: null },
          entries: [
            { accountId: escrowId, amountMinor: -100_000 },
            { accountId: walletId, amountMinor: 100_000 },
          ],
        });
    await db.transaction(settle('payout', seller.walletId as string));
    await expectRule(
      db.transaction(settle('refund', buyer.walletId as string)),
      'ledger_transfers_deal_settlement_key',
    );
  });

  it('never changes, deletes or truncates a transfer (Story 3 scenario 6)', async () => {
    const { transferId } = await committedCorrection();
    await expectRule(
      db.query("UPDATE ledger_transfers SET actor_ref = 'x' WHERE id = $1", [
        transferId,
      ]),
      'ledger_transfers_append_only',
    );
    await expectRule(
      db.query('DELETE FROM ledger_transfers WHERE id = $1', [transferId]),
      'ledger_transfers_append_only',
    );
    // Rolled back in case the guard ever fails: the ledger is shared.
    await expectRule(
      rolledBack(db, (tx) =>
        tx.query('TRUNCATE ledger_transfers, ledger_entries'),
      ),
      'ledger_transfers_no_truncate',
    );
  });

  it('requires the type, the actor type and the creation time', async () => {
    await expectRequiredColumns(db, 'ledger_transfers', transferRow, [
      'type',
      'actor_type',
      'created_at',
    ]);
  });
});

describe('ledger_entries', () => {
  it('commits a transfer whose entries sum to 0 (Story 3 scenario 1)', async () => {
    const { transferId } = await committedCorrection();
    expect(
      await db.query(
        'SELECT sum(amount_minor)::int AS sum FROM ledger_entries WHERE transfer_id = $1',
        [transferId],
      ),
    ).toEqual([{ sum: 0 }]);
  });

  it('rejects an unbalanced transfer at commit and keeps none of its rows (Story 3 scenario 2)', async () => {
    const { walletId, correctionId } = await correctionSource();
    await expectRule(
      db.transaction((tx) =>
        writeTransfer(tx, {
          type: 'correction',
          source: { correctionId },
          entries: [
            { accountId: bankClearingId, amountMinor: -90 },
            { accountId: walletId, amountMinor: 100 },
          ],
        }),
      ),
      'ledger_transfers_balanced',
    );
    expect(
      await db.query(
        'SELECT id FROM ledger_transfers WHERE correction_id = $1',
        [correctionId],
      ),
    ).toEqual([]);
  });

  it('rejects a transfer with a single entry (Story 3 scenario 3)', async () => {
    const { walletId, correctionId } = await correctionSource();
    await expectRule(
      db.transaction((tx) =>
        writeTransfer(tx, {
          type: 'correction',
          source: { correctionId },
          entries: [{ accountId: walletId, amountMinor: 100 }],
        }),
      ),
      'ledger_transfers_balanced',
    );
  });

  it('commits a transfer with three entries that sum to 0', async () => {
    const first = await createCompany(db);
    const { walletId, correctionId } = await correctionSource();
    await expect(
      db.transaction((tx) =>
        writeTransfer(tx, {
          type: 'correction',
          source: { correctionId },
          entries: [
            { accountId: walletId, amountMinor: 50 },
            { accountId: first.walletId as string, amountMinor: 50 },
            { accountId: bankClearingId, amountMinor: -100 },
          ],
        }),
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it('rejects an entry of 0, even inside a balanced transfer', async () => {
    const { walletId, correctionId } = await correctionSource();
    await expectRule(
      db.transaction((tx) =>
        writeTransfer(tx, {
          type: 'correction',
          source: { correctionId },
          entries: [
            { accountId: bankClearingId, amountMinor: -100 },
            { accountId: walletId, amountMinor: 100 },
            { accountId: walletId, amountMinor: 0 },
          ],
        }),
      ),
      'ledger_entries_amount_not_zero',
    );
  });

  it('rejects the whole commit when one of two transfers does not balance', async () => {
    const good = await correctionSource();
    const bad = await correctionSource();
    await expectRule(
      db.transaction(async (tx) => {
        await balancedCorrection(tx, good);
        await writeTransfer(tx, {
          type: 'correction',
          source: { correctionId: bad.correctionId },
          entries: [
            { accountId: bankClearingId, amountMinor: -100 },
            { accountId: bad.walletId, amountMinor: 99 },
          ],
        });
      }),
      'ledger_transfers_balanced',
    );
    expect(
      await db.query(
        'SELECT id FROM ledger_transfers WHERE correction_id = ANY($1)',
        [[good.correctionId, bad.correctionId]],
      ),
    ).toEqual([]);
  });

  it('rejects an entry added later to a committed transfer', async () => {
    const { transferId, walletId } = await committedCorrection();
    await expectRule(
      insertRow(db, 'ledger_entries', {
        transfer_id: transferId,
        account_id: walletId,
        amount_minor: 1,
        balance_after_minor: 1,
      }),
      'ledger_transfers_balanced',
    );
  });

  it('points only to an existing transfer and account', async () => {
    const { transferId, walletId } = await committedCorrection();
    await expectRule(
      insertRow(db, 'ledger_entries', {
        transfer_id: randomUUID(),
        account_id: walletId,
        amount_minor: 1,
        balance_after_minor: 1,
      }),
      'ledger_entries_transfer_id_fkey',
    );
    await expectRule(
      insertRow(db, 'ledger_entries', {
        transfer_id: transferId,
        account_id: randomUUID(),
        amount_minor: 1,
        balance_after_minor: 1,
      }),
      'ledger_entries_account_id_fkey',
    );
  });

  it('never changes, deletes or truncates an entry (Story 3 scenario 6)', async () => {
    const { transferId } = await committedCorrection();
    await expectRule(
      db.query(
        'UPDATE ledger_entries SET amount_minor = amount_minor * 2 WHERE transfer_id = $1',
        [transferId],
      ),
      'ledger_entries_append_only',
    );
    await expectRule(
      db.query('DELETE FROM ledger_entries WHERE transfer_id = $1', [
        transferId,
      ]),
      'ledger_entries_append_only',
    );
    await expectRule(
      rolledBack(db, (tx) => tx.query('TRUNCATE ledger_entries')),
      'ledger_entries_no_truncate',
    );
  });

  it('requires every column', async () => {
    const { transferId, walletId } = await committedCorrection();
    await expectRequiredColumns(
      db,
      'ledger_entries',
      () =>
        Promise.resolve({
          transfer_id: transferId,
          account_id: walletId,
          amount_minor: 1,
          balance_after_minor: 1,
        }),
      [
        'transfer_id',
        'account_id',
        'amount_minor',
        'balance_after_minor',
        'created_at',
      ],
    );
  });

  it('holds no committed transfer with fewer than 2 entries or a non-zero sum (SC-004)', async () => {
    expect(
      await db.query(
        `SELECT t.id FROM ledger_transfers t
         LEFT JOIN ledger_entries e ON e.transfer_id = t.id
         GROUP BY t.id
         HAVING count(e.id) < 2 OR coalesce(sum(e.amount_minor), 0) <> 0`,
      ),
    ).toEqual([]);
  });
});
