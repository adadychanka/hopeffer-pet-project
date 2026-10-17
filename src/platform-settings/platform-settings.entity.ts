import {
  Check,
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// The operator's limits and time windows. Exactly one row (id 1), created by
// the migration with the defaults. Deals and invoices copy the values they
// need when they are created, so a change applies to new deals only.
@Entity({ name: 'platform_settings' })
@Check('platform_settings_single_row', '"id" = 1')
@Check(
  'platform_settings_payment_window_days_check',
  '"payment_window_days" >= 1',
)
@Check('platform_settings_grace_period_days_check', '"grace_period_days" >= 0')
@Check('platform_settings_max_unpaid_deals_check', '"max_unpaid_deals" >= 1')
@Check('platform_settings_expiry_limit_check', '"expiry_limit" >= 1')
@Check(
  'platform_settings_expiry_lookback_days_check',
  '"expiry_lookback_days" >= 1',
)
@Check(
  'platform_settings_confirmation_window_days_check',
  '"confirmation_window_days" >= 1',
)
export class PlatformSettings {
  @PrimaryColumn({
    type: 'smallint',
    name: 'id',
    default: 1,
    primaryKeyConstraintName: 'platform_settings_pkey',
  })
  id!: number;

  @Column({ type: 'integer', name: 'payment_window_days', default: 5 })
  paymentWindowDays!: number;

  @Column({ type: 'integer', name: 'grace_period_days', default: 1 })
  gracePeriodDays!: number;

  @Column({ type: 'integer', name: 'max_unpaid_deals', default: 3 })
  maxUnpaidDeals!: number;

  @Column({ type: 'integer', name: 'expiry_limit', default: 2 })
  expiryLimit!: number;

  @Column({ type: 'integer', name: 'expiry_lookback_days', default: 30 })
  expiryLookbackDays!: number;

  @Column({ type: 'integer', name: 'confirmation_window_days', default: 14 })
  confirmationWindowDays!: number;

  @Column({ type: 'text', name: 'updated_by_ref', nullable: true })
  updatedByRef!: string | null;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
  /* v8 ignore stop */
}
