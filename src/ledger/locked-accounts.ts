import type { EntityManager } from 'typeorm';
import type { ActorType } from '../database/actor-types.js';
import { DomainError } from '../http/domain-error.js';
import type { AccountType } from './account.entity.js';
import type { TransferType } from './ledger-transfer.entity.js';

export interface LockedAccountRow {
  id: string;
  type: AccountType;
  balanceMinor: number;
}

// One account's side of a transfer: positive into the account, negative out.
export interface Leg {
  accountId: string;
  amountMinor: number;
}

export interface PostedLeg extends Leg {
  balanceAfterMinor: number;
}

export interface TransferActor {
  type: ActorType;
  // Null exactly for the system actor.
  ref: string | null;
}

export interface Transfer {
  type: TransferType;
  // The top-up, invoice, deal or correction the transfer posts; the column
  // follows from the type.
  sourceId: string;
  actor: TransferActor;
  legs: Leg[];
}

// The source column of each transfer type (ledger_transfers_*_matches_type).
const SOURCE_COLUMNS = {
  top_up: 'top_up_id',
  invoice_payment: 'invoice_id',
  payout: 'deal_id',
  refund: 'deal_id',
  correction: 'correction_id',
} as const satisfies Record<TransferType, string>;

function balanceAllowed(type: AccountType, balanceMinor: number): boolean {
  // Bank clearing is the counterpart of money that entered from the bank, so
  // it only goes down; wallets and escrow never go below 0.
  return type === 'bank_clearing' ? balanceMinor <= 0 : balanceMinor >= 0;
}

// The accounts one transaction has locked (lockAccounts() in posting.ts),
// with their balances. Every transfer of the transaction posts through it,
// so a second transfer starts from the balances the first one left.
export class LockedAccounts {
  private readonly accounts: Map<
    string,
    { type: AccountType; balanceMinor: number }
  >;

  constructor(rows: LockedAccountRow[]) {
    this.accounts = new Map(
      rows.map((row) => [
        row.id,
        { type: row.type, balanceMinor: row.balanceMinor },
      ]),
    );
  }

  balanceOf(accountId: string): number {
    return this.account(accountId).balanceMinor;
  }

  // Checks the legs and computes the new balances. Wrong legs are a bug in
  // the caller (plain Error); a balance the rules forbid is the caller's
  // insufficient_balance. Nothing changes unless every leg passes.
  apply(legs: Leg[]): PostedLeg[] {
    if (legs.length < 2) {
      throw new Error('A transfer needs at least 2 legs');
    }
    let sum = 0;
    const posted = legs.map((leg) => {
      if (leg.amountMinor === 0 || !Number.isSafeInteger(leg.amountMinor)) {
        throw new Error(`Invalid leg amount ${leg.amountMinor}`);
      }
      sum += leg.amountMinor;
      return { ...leg, balanceAfterMinor: 0 };
    });
    if (sum !== 0) {
      throw new Error(`Transfer legs sum to ${sum}, not 0`);
    }
    const next = new Map<string, number>();
    for (const leg of posted) {
      const account = this.account(leg.accountId);
      const balance =
        (next.get(leg.accountId) ?? account.balanceMinor) + leg.amountMinor;
      if (!Number.isSafeInteger(balance)) {
        throw new RangeError(
          `Balance of ${leg.accountId} leaves the safe range`,
        );
      }
      if (!balanceAllowed(account.type, balance)) {
        throw new DomainError('insufficient_balance');
      }
      next.set(leg.accountId, balance);
      leg.balanceAfterMinor = balance;
    }
    for (const [accountId, balance] of next) {
      this.account(accountId).balanceMinor = balance;
    }
    return posted;
  }

  // Writes one transfer: the balances, the transfer row and one entry per
  // leg. The deferred trigger ledger_transfers_balanced checks the result
  // again at commit.
  async post(manager: EntityManager, transfer: Transfer): Promise<string> {
    const legs = this.apply(transfer.legs);
    const rows = await manager.query<{ id: string }[]>(
      `INSERT INTO ledger_transfers (type, ${SOURCE_COLUMNS[transfer.type]}, actor_type, actor_ref, entry_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        transfer.type,
        transfer.sourceId,
        transfer.actor.type,
        transfer.actor.ref,
        legs.length,
      ],
    );
    const transferId = rows[0].id;
    for (const leg of legs) {
      await manager.query(
        `INSERT INTO ledger_entries (transfer_id, account_id, amount_minor, balance_after_minor)
         VALUES ($1, $2, $3, $4)`,
        [transferId, leg.accountId, leg.amountMinor, leg.balanceAfterMinor],
      );
      await manager.query(
        'UPDATE accounts SET balance_minor = $2 WHERE id = $1',
        [leg.accountId, leg.balanceAfterMinor],
      );
    }
    return transferId;
  }

  private account(accountId: string) {
    const account = this.accounts.get(accountId);
    if (account === undefined) {
      throw new Error(`Account ${accountId} is not locked`);
    }
    return account;
  }
}
