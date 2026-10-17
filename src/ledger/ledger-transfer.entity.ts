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
import { ACTOR_TYPES, type ActorType } from '../database/actor-types.js';
import { sqlList } from '../database/sql-list.js';
import { Deal } from '../deals/deal.entity.js';
import { Invoice } from '../deals/invoice.entity.js';
import { Correction } from './correction.entity.js';
import { TopUp } from './top-up.entity.js';

export const TRANSFER_TYPES = [
  'top_up',
  'invoice_payment',
  'payout',
  'refund',
  'correction',
] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

// One money movement. It points to exactly one source record, which matches
// its type. Its entries sum to 0, checked at commit by deferred triggers in
// the migration; transfers and entries are never changed or deleted.
@Entity({ name: 'ledger_transfers' })
@Check('ledger_transfers_type_check', `"type" IN (${sqlList(TRANSFER_TYPES)})`)
@Check(
  'ledger_transfers_one_source',
  'num_nonnulls("top_up_id", "invoice_id", "deal_id", "correction_id") = 1',
)
@Check(
  'ledger_transfers_top_up_matches_type',
  `("type" = 'top_up') = ("top_up_id" IS NOT NULL)`,
)
@Check(
  'ledger_transfers_invoice_matches_type',
  `("type" = 'invoice_payment') = ("invoice_id" IS NOT NULL)`,
)
@Check(
  'ledger_transfers_deal_matches_type',
  `("type" IN ('payout', 'refund')) = ("deal_id" IS NOT NULL)`,
)
@Check(
  'ledger_transfers_correction_matches_type',
  `("type" = 'correction') = ("correction_id" IS NOT NULL)`,
)
@Check(
  'ledger_transfers_actor_type_check',
  `"actor_type" IN (${sqlList(ACTOR_TYPES)})`,
)
@Check(
  'ledger_transfers_actor_ref_matches_type',
  `("actor_type" = 'system') = ("actor_ref" IS NULL)`,
)
@Unique('ledger_transfers_top_up_id_key', ['topUpId'])
@Unique('ledger_transfers_correction_id_key', ['correctionId'])
// An invoice is paid once.
@Index('ledger_transfers_invoice_payment_key', ['invoiceId'], {
  unique: true,
  where: `"type" = 'invoice_payment'`,
})
// A deal ends with one payout or one refund, never both.
@Index('ledger_transfers_deal_settlement_key', ['dealId'], {
  unique: true,
  where: `"type" IN ('payout', 'refund')`,
})
export class LedgerTransfer {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'ledger_transfers_pkey',
  })
  id!: string;

  @Column({ type: 'text', name: 'type' })
  type!: TransferType;

  @Column({ type: 'uuid', name: 'top_up_id', nullable: true })
  @ForeignKey(() => TopUp, 'id', { name: 'ledger_transfers_top_up_id_fkey' })
  topUpId!: string | null;

  @Column({ type: 'uuid', name: 'invoice_id', nullable: true })
  @ForeignKey(() => Invoice, 'id', {
    name: 'ledger_transfers_invoice_id_fkey',
  })
  invoiceId!: string | null;

  @Column({ type: 'uuid', name: 'deal_id', nullable: true })
  @ForeignKey(() => Deal, 'id', { name: 'ledger_transfers_deal_id_fkey' })
  dealId!: string | null;

  @Column({ type: 'uuid', name: 'correction_id', nullable: true })
  @ForeignKey(() => Correction, 'id', {
    name: 'ledger_transfers_correction_id_fkey',
  })
  correctionId!: string | null;

  @Column({ type: 'text', name: 'actor_type' })
  actorType!: ActorType;

  @Column({ type: 'text', name: 'actor_ref', nullable: true })
  actorRef!: string | null;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
  /* v8 ignore stop */
}
