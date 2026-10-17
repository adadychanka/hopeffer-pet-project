import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Lot } from '../catalog/lot.entity.js';
import { safeBigint } from '../database/safe-bigint.js';
import { sqlList } from '../database/sql-list.js';
import { Account } from '../ledger/account.entity.js';

export const DEAL_STATUSES = [
  'awaiting_payment',
  'paid',
  'shipped',
  'disputed',
  'completed',
  'cancelled',
  'expired',
  'refunded',
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

// One purchase of units of one lot. Buyer and seller point at their wallets,
// so both need one. The composite foreign key keeps the seller equal to the
// lot's seller and stops a lot with deals from being deleted.
@Entity({ name: 'deals' })
@ForeignKey(
  () => Lot,
  ['lotId', 'sellerCompanyId'],
  ['id', 'sellerCompanyId'],
  {
    name: 'deals_lot_seller_fkey',
    onDelete: 'RESTRICT',
  },
)
@Check('deals_quantity_positive', '"quantity" >= 1')
@Check('deals_unit_price_positive', '"unit_price_minor" > 0')
@Check('deals_total_matches', '"total_minor" = "quantity" * "unit_price_minor"')
@Check('deals_buyer_not_seller', '"buyer_company_id" <> "seller_company_id"')
@Check('deals_status_check', `"status" IN (${sqlList(DEAL_STATUSES)})`)
@Check(
  'deals_shipped_has_deadline',
  `("status" IN ('shipped', 'disputed', 'completed')) <= ("confirmation_due_at" IS NOT NULL)`,
)
// A retried purchase with the same key never creates a second deal.
@Unique('deals_buyer_idempotency_key_key', ['buyerCompanyId', 'idempotencyKey'])
@Index('deals_buyer_company_id_status_idx', ['buyerCompanyId', 'status'])
@Index('deals_seller_company_id_status_idx', ['sellerCompanyId', 'status'])
@Index('deals_lot_id_idx', ['lotId'])
@Index('deals_shipped_confirmation_due_at_idx', ['confirmationDueAt'], {
  where: `"status" = 'shipped'`,
})
export class Deal {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'deals_pkey' })
  id!: string;

  @Column({ type: 'uuid', name: 'lot_id' })
  lotId!: string;

  @Column({ type: 'uuid', name: 'buyer_company_id' })
  @ForeignKey(() => Account, 'companyId', {
    name: 'deals_buyer_company_id_fkey',
  })
  buyerCompanyId!: string;

  @Column({ type: 'uuid', name: 'seller_company_id' })
  @ForeignKey(() => Account, 'companyId', {
    name: 'deals_seller_company_id_fkey',
  })
  sellerCompanyId!: string;

  @Column({ type: 'integer', name: 'quantity' })
  quantity!: number;

  // Copied from the lot at purchase; later price changes never touch it.
  @Column({ type: 'bigint', name: 'unit_price_minor', transformer: safeBigint })
  unitPriceMinor!: number;

  @Column({ type: 'bigint', name: 'total_minor', transformer: safeBigint })
  totalMinor!: number;

  @Column({ type: 'text', name: 'status' })
  status!: DealStatus;

  @Column({ type: 'timestamptz', name: 'confirmation_due_at', nullable: true })
  confirmationDueAt!: Date | null;

  @Column({ type: 'uuid', name: 'idempotency_key' })
  idempotencyKey!: string;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
  /* v8 ignore stop */

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
  /* v8 ignore stop */
}
