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
import { safeBigint } from '../database/safe-bigint.js';
import { sqlList } from '../database/sql-list.js';
import { Account } from '../ledger/account.entity.js';

export const LOT_STATUSES = ['hidden', 'published'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

// Units of one item that a seller offers. The seller reference points at the
// seller's wallet (accounts.company_id), so a company needs its wallet before
// it can create a lot. Reserved units are already subtracted from the stock.
@Entity({ name: 'lots' })
@Check('lots_title_length', 'char_length("title") BETWEEN 1 AND 200')
@Check('lots_unit_price_positive', '"unit_price_minor" > 0')
@Check('lots_stock_not_negative', '"stock_available" >= 0')
@Check('lots_status_check', `"status" IN (${sqlList(LOT_STATUSES)})`)
// Target of the composite foreign key from deals, which keeps a deal's seller
// equal to its lot's seller.
@Unique('lots_id_seller_company_id_key', ['id', 'sellerCompanyId'])
@Index('lots_seller_company_id_idx', ['sellerCompanyId'])
@Index('lots_published_created_at_idx', ['createdAt'], {
  where: `"status" = 'published'`,
})
export class Lot {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'lots_pkey' })
  id!: string;

  @Column({ type: 'uuid', name: 'seller_company_id' })
  @ForeignKey(() => Account, 'companyId', {
    name: 'lots_seller_company_id_fkey',
  })
  sellerCompanyId!: string;

  @Column({ type: 'text', name: 'title' })
  title!: string;

  @Column({ type: 'bigint', name: 'unit_price_minor', transformer: safeBigint })
  unitPriceMinor!: number;

  @Column({ type: 'integer', name: 'stock_available' })
  stockAvailable!: number;

  @Column({ type: 'text', name: 'status', default: 'hidden' })
  status!: LotStatus;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
  /* v8 ignore stop */

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
  /* v8 ignore stop */
}
