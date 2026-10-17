import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { safeBigint } from '../database/safe-bigint.js';
import { Account } from './account.entity.js';
import { TopUp } from './top-up.entity.js';

// The operator's fix of a wrong company balance. Positive adds to the wallet.
// The idempotency key stops a retried submission from moving money twice.
@Entity({ name: 'corrections' })
@Unique('corrections_idempotency_key_key', ['idempotencyKey'])
@Check('corrections_amount_not_zero', '"amount_minor" <> 0')
@Check('corrections_reason_length', 'char_length("reason") BETWEEN 1 AND 1000')
export class Correction {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'corrections_pkey',
  })
  id!: string;

  @Column({ type: 'uuid', name: 'company_id' })
  @ForeignKey(() => Account, 'companyId', {
    name: 'corrections_company_id_fkey',
  })
  companyId!: string;

  @Column({ type: 'bigint', name: 'amount_minor', transformer: safeBigint })
  amountMinor!: number;

  @Column({ type: 'text', name: 'reason' })
  reason!: string;

  // The top-up being fixed, if any.
  @Column({ type: 'uuid', name: 'top_up_id', nullable: true })
  @ForeignKey(() => TopUp, 'id', { name: 'corrections_top_up_id_fkey' })
  topUpId!: string | null;

  @Column({ type: 'text', name: 'operator_ref' })
  operatorRef!: string;

  @Column({ type: 'uuid', name: 'idempotency_key' })
  idempotencyKey!: string;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
  /* v8 ignore stop */
}
