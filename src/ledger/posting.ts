import type { EntityManager } from 'typeorm';
import { parseSafeBigint } from '../database/safe-bigint.js';
import type { AccountType } from './account.entity.js';
import { LockedAccounts } from './locked-accounts.js';

// Plain functions, not a Nest provider: posting needs nothing but the
// transaction's EntityManager (feature 003 research R3).

// Locks every account an operation may touch, in one statement sorted by id.
// Every money operation locks this way, before any other row, so two
// operations never wait on each other in a circle (research R2).
export async function lockAccounts(
  manager: EntityManager,
  accountIds: string[],
): Promise<LockedAccounts> {
  const ids = [...new Set(accountIds)];
  const rows = await manager.query<
    { id: string; type: AccountType; balance_minor: string }[]
  >(
    `SELECT id, type, balance_minor FROM accounts
     WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  if (rows.length !== ids.length) {
    throw new Error('An account to lock does not exist');
  }
  return new LockedAccounts(
    rows.map((row) => ({
      id: row.id,
      type: row.type,
      balanceMinor: parseSafeBigint(row.balance_minor) as number,
    })),
  );
}

export interface PlatformAccountIds {
  escrowId: string;
  bankClearingId: string;
}

// The migration seeds exactly one escrow and one bank clearing account.
export async function platformAccountIds(
  manager: EntityManager,
): Promise<PlatformAccountIds> {
  const rows = await manager.query<
    { escrow_id: string; bank_clearing_id: string }[]
  >(
    `SELECT (SELECT id FROM accounts WHERE type = 'escrow') AS escrow_id,
            (SELECT id FROM accounts WHERE type = 'bank_clearing') AS bank_clearing_id`,
  );
  return {
    escrowId: rows[0].escrow_id,
    bankClearingId: rows[0].bank_clearing_id,
  };
}
