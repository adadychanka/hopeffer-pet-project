// Posting: lockAccounts() and LockedAccounts.post() write transfers, entries
// and balances, against the real database.
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockAccounts, platformAccountIds } from '../../src/ledger/posting.js';
import {
  createCompany,
  createCorrection,
  ledgerEntriesOf,
  walletBalance,
} from '../schema/helpers.js';
import { bootApp, type BootedApp } from './helpers.js';

let booted: BootedApp;
let db: DataSource;

beforeAll(async () => {
  booted = await bootApp();
  db = booted.db;
});

afterAll(async () => {
  await booted.app.close();
});

const operator = { type: 'operator' as const, ref: 'operator-1' };

describe('posting', () => {
  it('writes two transfers on one wallet with consecutive balances', async () => {
    const company = await createCompany(db);
    const walletId = company.walletId as string;
    const first = await createCorrection(db, company.id, { amountMinor: 700 });
    const second = await createCorrection(db, company.id, {
      amountMinor: -200,
    });

    const transferIds = await db.transaction(async (manager) => {
      const { bankClearingId } = await platformAccountIds(manager);
      const locked = await lockAccounts(manager, [walletId, bankClearingId]);
      return [
        await locked.post(manager, {
          type: 'correction',
          sourceId: first,
          actor: operator,
          legs: [
            { accountId: bankClearingId, amountMinor: -700 },
            { accountId: walletId, amountMinor: 700 },
          ],
        }),
        await locked.post(manager, {
          type: 'correction',
          sourceId: second,
          actor: operator,
          legs: [
            { accountId: walletId, amountMinor: -200 },
            { accountId: bankClearingId, amountMinor: 200 },
          ],
        }),
      ];
    });

    const walletAfter = async (transferId: string) =>
      (await ledgerEntriesOf(db, transferId)).find(
        (entry) => entry.accountId === walletId,
      )?.balanceAfterMinor;
    expect(await walletAfter(transferIds[0])).toBe(700);
    expect(await walletAfter(transferIds[1])).toBe(500);
    expect(await walletBalance(db, company.id)).toBe(500);
  });

  it('rolls back a posting that would take a wallet below 0', async () => {
    const company = await createCompany(db);
    const walletId = company.walletId as string;
    const correctionId = await createCorrection(db, company.id, {
      amountMinor: -1,
    });

    await expect(
      db.transaction(async (manager) => {
        const { bankClearingId } = await platformAccountIds(manager);
        const locked = await lockAccounts(manager, [walletId, bankClearingId]);
        await locked.post(manager, {
          type: 'correction',
          sourceId: correctionId,
          actor: operator,
          legs: [
            { accountId: walletId, amountMinor: -1 },
            { accountId: bankClearingId, amountMinor: 1 },
          ],
        });
      }),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
    const transfers = await db.query<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM ledger_transfers WHERE correction_id = $1',
      [correctionId],
    );
    expect(transfers[0].n).toBe(0);
  });

  it('locks each requested account once and fails on an unknown one', async () => {
    const company = await createCompany(db);
    const walletId = company.walletId as string;

    await db.transaction(async (manager) => {
      const locked = await lockAccounts(manager, [walletId, walletId]);
      expect(locked.balanceOf(walletId)).toBe(0);
    });
    await expect(
      db.transaction((manager) => lockAccounts(manager, [randomUUID()])),
    ).rejects.toThrow('An account to lock does not exist');
  });
});
