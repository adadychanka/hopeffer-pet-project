import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { safeBigint } from '../database/safe-bigint.js';
import { Account } from './account.entity.js';
import { LedgerTransfer } from './ledger-transfer.entity.js';

// One account's side of a transfer: positive into the account, negative out
// of it. The identity key orders an account statement.
@Entity({ name: 'ledger_entries' })
@Check('ledger_entries_amount_not_zero', '"amount_minor" <> 0')
// For the zero-sum trigger, which sums the entries of one transfer.
@Index('ledger_entries_transfer_id_idx', ['transferId'])
@Index('ledger_entries_account_id_id_idx', ['accountId', 'id'])
export class LedgerEntry {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'ledger_entries_pkey',
  })
  id!: string;

  @Column({ type: 'uuid', name: 'transfer_id' })
  @ForeignKey(() => LedgerTransfer, 'id', {
    name: 'ledger_entries_transfer_id_fkey',
  })
  transferId!: string;

  @Column({ type: 'uuid', name: 'account_id' })
  @ForeignKey(() => Account, 'id', { name: 'ledger_entries_account_id_fkey' })
  accountId!: string;

  @Column({ type: 'bigint', name: 'amount_minor', transformer: safeBigint })
  amountMinor!: number;

  @Column({
    type: 'bigint',
    name: 'balance_after_minor',
    transformer: safeBigint,
  })
  balanceAfterMinor!: number;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
  /* v8 ignore stop */
}
