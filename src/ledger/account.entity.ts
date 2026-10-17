import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Company } from '../companies/company.entity.js';
import { safeBigint } from '../database/safe-bigint.js';
import { sqlList } from '../database/sql-list.js';

export const ACCOUNT_TYPES = [
  'company_wallet',
  'escrow',
  'bank_clearing',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// A place that holds money: a company wallet (zero or one per company) or one
// of the two platform accounts, escrow and bank clearing, which have no
// company. A trigger in the migration rejects deletes and changes of type or
// company, so only the balance ever changes.
@Entity({ name: 'accounts' })
@Check('accounts_type_check', `"type" IN (${sqlList(ACCOUNT_TYPES)})`)
@Check(
  'accounts_company_matches_type',
  `("type" = 'company_wallet') = ("company_id" IS NOT NULL)`,
)
@Check(
  'accounts_balance_not_negative',
  `"type" = 'bank_clearing' OR "balance_minor" >= 0`,
)
@Check(
  'accounts_bank_clearing_not_positive',
  `"type" <> 'bank_clearing' OR "balance_minor" <= 0`,
)
// A full unique constraint, not a partial index: the wallet foreign keys of
// lots, deals, top-ups and corrections point at this column.
@Unique('accounts_company_id_key', ['companyId'])
@Index('accounts_platform_type_key', ['type'], {
  unique: true,
  where: `"type" <> 'company_wallet'`,
})
export class Account {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'accounts_pkey' })
  id!: string;

  @Column({ type: 'text', name: 'type' })
  type!: AccountType;

  @Column({ type: 'uuid', name: 'company_id', nullable: true })
  @ForeignKey(() => Company, 'id', {
    name: 'accounts_company_id_fkey',
    onDelete: 'RESTRICT',
  })
  companyId!: string | null;

  @Column({
    type: 'bigint',
    name: 'balance_minor',
    default: 0,
    transformer: safeBigint,
  })
  balanceMinor!: number;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
  /* v8 ignore stop */
}
