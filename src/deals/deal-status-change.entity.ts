import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ACTOR_TYPES, type ActorType } from '../database/actor-types.js';
import { sqlList } from '../database/sql-list.js';
import { DEAL_STATUSES, Deal, type DealStatus } from './deal.entity.js';

// One step of a deal's lifecycle. Append-only: a trigger in the migration
// rejects updates and deletes.
@Entity({ name: 'deal_status_changes' })
@Check(
  'deal_status_changes_from_status_check',
  `"from_status" IS NULL OR "from_status" IN (${sqlList(DEAL_STATUSES)})`,
)
@Check(
  'deal_status_changes_to_status_check',
  `"to_status" IN (${sqlList(DEAL_STATUSES)})`,
)
@Check(
  'deal_status_changes_actor_type_check',
  `"actor_type" IN (${sqlList(ACTOR_TYPES)})`,
)
@Check(
  'deal_status_changes_actor_ref_matches_type',
  `("actor_type" = 'system') = ("actor_ref" IS NULL)`,
)
@Check(
  'deal_status_changes_reason_required',
  `"to_status" NOT IN ('disputed', 'refunded') OR ("reason" IS NOT NULL AND btrim("reason") <> '')`,
)
// Only the first row of a deal has no previous status.
@Index('deal_status_changes_creation_key', ['dealId'], {
  unique: true,
  where: '"from_status" IS NULL',
})
@Index('deal_status_changes_deal_id_id_idx', ['dealId', 'id'])
export class DealStatusChange {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'deal_status_changes_pkey',
  })
  id!: string;

  @Column({ type: 'uuid', name: 'deal_id' })
  @ForeignKey(() => Deal, 'id', { name: 'deal_status_changes_deal_id_fkey' })
  dealId!: string;

  @Column({ type: 'text', name: 'from_status', nullable: true })
  fromStatus!: DealStatus | null;

  @Column({ type: 'text', name: 'to_status' })
  toStatus!: DealStatus;

  @Column({ type: 'text', name: 'actor_type' })
  actorType!: ActorType;

  @Column({ type: 'text', name: 'actor_ref', nullable: true })
  actorRef!: string | null;

  @Column({ type: 'text', name: 'reason', nullable: true })
  reason!: string | null;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @Column({ type: 'timestamptz', name: 'changed_at', default: () => 'now()' })
  changedAt!: Date;
  /* v8 ignore stop */
}
