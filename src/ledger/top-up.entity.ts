import {
  Check,
  Column,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { safeBigint } from '../database/safe-bigint.js';
import { Invoice } from '../deals/invoice.entity.js';
import { Account } from './account.entity.js';

// The operator's record of one bank notification. The bank reference is
// stored in its electronic format: upper case, no whitespace, and only the
// SEPA reference characters. The service removes all whitespace and
// upper-cases it, so one notification is recorded once however it was typed.
// Banks store IBANs (ISO 13616) and RF references (ISO 11649) the same way.
@Entity({ name: 'top_ups' })
@Unique('top_ups_bank_reference_key', ['bankReference'])
@Check('top_ups_amount_positive', '"amount_minor" > 0')
@Check(
  'top_ups_bank_reference_normalized',
  `"bank_reference" ~ '^[A-Z0-9/?:().,''+-]+$'`,
)
export class TopUp {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'top_ups_pkey' })
  id!: string;

  // The wallet that receives the money.
  @Column({ type: 'uuid', name: 'company_id' })
  @ForeignKey(() => Account, 'companyId', { name: 'top_ups_company_id_fkey' })
  companyId!: string;

  @Column({ type: 'bigint', name: 'amount_minor', transformer: safeBigint })
  amountMinor!: number;

  @Column({ type: 'text', name: 'bank_reference' })
  bankReference!: string;

  // Value date from the bank notification, YYYY-MM-DD.
  @Column({ type: 'date', name: 'transfer_date' })
  transferDate!: string;

  // The invoice named in the transfer reference, if any.
  @Column({ type: 'uuid', name: 'invoice_id', nullable: true })
  @ForeignKey(() => Invoice, 'id', { name: 'top_ups_invoice_id_fkey' })
  invoiceId!: string | null;

  @Column({ type: 'text', name: 'operator_ref' })
  operatorRef!: string;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @Column({ type: 'timestamptz', name: 'recorded_at', default: () => 'now()' })
  recordedAt!: Date;
  /* v8 ignore stop */
}
