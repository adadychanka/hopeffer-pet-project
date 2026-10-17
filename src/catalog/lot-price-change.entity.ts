import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { safeBigint } from '../database/safe-bigint.js';
import { sqlList } from '../database/sql-list.js';
import { Lot } from './lot.entity.js';

export const PRICE_ACTOR_TYPES = ['seller', 'operator'] as const;
export type PriceActorType = (typeof PRICE_ACTOR_TYPES)[number];

// The price history of a lot. The service writes the creation row (no old
// price) with the lot and one row per price change, in the same transaction.
// A trigger in the migration rejects updates, and deletes other than the
// cascade of the lot's own delete.
@Entity({ name: 'lot_price_changes' })
@Check(
  'lot_price_changes_old_price_positive',
  '"old_price_minor" IS NULL OR "old_price_minor" > 0',
)
@Check('lot_price_changes_new_price_positive', '"new_price_minor" > 0')
@Check(
  'lot_price_changes_price_changed',
  '"old_price_minor" IS DISTINCT FROM "new_price_minor"',
)
@Check(
  'lot_price_changes_actor_type_check',
  `"actor_type" IN (${sqlList(PRICE_ACTOR_TYPES)})`,
)
@Index('lot_price_changes_creation_key', ['lotId'], {
  unique: true,
  where: '"old_price_minor" IS NULL',
})
@Index('lot_price_changes_lot_id_id_idx', ['lotId', 'id'])
export class LotPriceChange {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'lot_price_changes_pkey',
  })
  id!: string;

  @Column({ type: 'uuid', name: 'lot_id' })
  @ForeignKey(() => Lot, 'id', {
    name: 'lot_price_changes_lot_id_fkey',
    onDelete: 'CASCADE',
  })
  lotId!: string;

  @Column({
    type: 'bigint',
    name: 'old_price_minor',
    nullable: true,
    transformer: safeBigint,
  })
  oldPriceMinor!: number | null;

  @Column({ type: 'bigint', name: 'new_price_minor', transformer: safeBigint })
  newPriceMinor!: number;

  @Column({ type: 'text', name: 'actor_type' })
  actorType!: PriceActorType;

  @Column({ type: 'text', name: 'actor_ref' })
  actorRef!: string;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @Column({ type: 'timestamptz', name: 'changed_at', default: () => 'now()' })
  changedAt!: Date;
  /* v8 ignore stop */
}
