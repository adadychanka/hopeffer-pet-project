import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { safeBigint } from '../database/safe-bigint.js';
import { sqlList } from '../database/sql-list.js';
import { Deal } from './deal.entity.js';

export const INVOICE_STATUSES = [
  'issued',
  'paid',
  'cancelled',
  'expired',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// The buyer's obligation to pay for one deal. The number comes from
// next_invoice_number() (created by the migration): INV-<year>-<at least 6
// digits> from one sequence.
@Entity({ name: 'invoices' })
@Unique('invoices_deal_id_key', ['dealId'])
@Unique('invoices_number_key', ['number'])
@Check('invoices_number_format', `"number" ~ '^INV-[0-9]{4}-[0-9]{6,}$'`)
@Check('invoices_amount_positive', '"amount_minor" > 0')
@Check('invoices_status_check', `"status" IN (${sqlList(INVOICE_STATUSES)})`)
@Check(
  'invoices_dates_ordered',
  '"issued_at" <= "due_at" AND "due_at" <= "expires_at"',
)
@Check(
  'invoices_paid_at_matches_status',
  `("status" = 'paid') = ("paid_at" IS NOT NULL)`,
)
@Index('invoices_issued_expires_at_idx', ['expiresAt'], {
  where: `"status" = 'issued'`,
})
export class Invoice {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'invoices_pkey' })
  id!: string;

  @Column({ type: 'uuid', name: 'deal_id' })
  @ForeignKey(() => Deal, 'id', { name: 'invoices_deal_id_fkey' })
  dealId!: string;

  @Column({
    type: 'text',
    name: 'number',
    default: () => 'next_invoice_number()',
  })
  number!: string;

  @Column({ type: 'bigint', name: 'amount_minor', transformer: safeBigint })
  amountMinor!: number;

  @Column({ type: 'text', name: 'status' })
  status!: InvoiceStatus;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt!: Date;
  /* v8 ignore stop */

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @Column({ type: 'timestamptz', name: 'due_at' })
  dueAt!: Date;
  /* v8 ignore stop */

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;
  /* v8 ignore stop */

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt!: Date | null;
}
