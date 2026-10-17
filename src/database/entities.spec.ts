import { DataSource, type EntityMetadata } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { entityClasses } from '../../test/setup/entity-classes.js';
import { buildTypeOrmOptions } from './typeorm-options.js';

// Builds the metadata of every *.entity.ts file without a database connection,
// the way the TypeORM CLI finds them (by file name). This checks that every
// named rule of specs/002-marketplace-schema/contracts/schema-rules.md is
// declared, and it runs the decorators so entity files count for coverage.
class MetadataDataSource extends DataSource {
  build(): Promise<void> {
    return this.buildMetadatas();
  }
}

function ruleNames(metadata: EntityMetadata): string[] {
  return [
    ...metadata.primaryColumns.map(
      (column) => column.primaryKeyConstraintName ?? '(unnamed primary key)',
    ),
    ...metadata.checks.map((check) => check.name),
    ...metadata.uniques.map((unique) => unique.name),
    ...metadata.indices.map((index) => index.name),
    ...metadata.foreignKeys.map((foreignKey) => foreignKey.name),
  ].sort();
}

const EXPECTED_RULES: Record<string, string[]> = {
  companies: [
    'companies_pkey',
    'companies_email_format',
    'companies_name_length',
    'companies_registration_number_key',
    'companies_email_lower_key',
  ],
  accounts: [
    'accounts_pkey',
    'accounts_balance_not_negative',
    'accounts_bank_clearing_not_positive',
    'accounts_company_matches_type',
    'accounts_type_check',
    'accounts_company_id_key',
    'accounts_platform_type_key',
    'accounts_company_id_fkey',
  ],
  platform_settings: [
    'platform_settings_pkey',
    'platform_settings_single_row',
    'platform_settings_payment_window_days_check',
    'platform_settings_grace_period_days_check',
    'platform_settings_max_unpaid_deals_check',
    'platform_settings_expiry_limit_check',
    'platform_settings_expiry_lookback_days_check',
    'platform_settings_confirmation_window_days_check',
  ],
  lots: [
    'lots_pkey',
    'lots_status_check',
    'lots_stock_not_negative',
    'lots_title_length',
    'lots_unit_price_positive',
    'lots_id_seller_company_id_key',
    'lots_published_created_at_idx',
    'lots_seller_company_id_idx',
    'lots_seller_company_id_fkey',
  ],
  lot_photos: [
    'lot_photos_pkey',
    'lot_photos_content_type_check',
    'lot_photos_height_px_positive',
    'lot_photos_original_filename_length',
    'lot_photos_position_not_negative',
    'lot_photos_size_bytes_positive',
    'lot_photos_width_px_positive',
    'lot_photos_lot_id_position_key',
    'lot_photos_storage_key_key',
    'lot_photos_lot_id_fkey',
  ],
  lot_price_changes: [
    'lot_price_changes_pkey',
    'lot_price_changes_actor_type_check',
    'lot_price_changes_new_price_positive',
    'lot_price_changes_old_price_positive',
    'lot_price_changes_price_changed',
    'lot_price_changes_creation_key',
    'lot_price_changes_lot_id_id_idx',
    'lot_price_changes_lot_id_fkey',
  ],
  deals: [
    'deals_pkey',
    'deals_buyer_not_seller',
    'deals_quantity_positive',
    'deals_shipped_has_deadline',
    'deals_status_check',
    'deals_total_matches',
    'deals_unit_price_positive',
    'deals_buyer_idempotency_key_key',
    'deals_buyer_company_id_status_idx',
    'deals_lot_id_idx',
    'deals_seller_company_id_status_idx',
    'deals_shipped_confirmation_due_at_idx',
    'deals_buyer_company_id_fkey',
    'deals_lot_seller_fkey',
    'deals_seller_company_id_fkey',
  ],
  deal_status_changes: [
    'deal_status_changes_pkey',
    'deal_status_changes_actor_ref_matches_type',
    'deal_status_changes_actor_type_check',
    'deal_status_changes_from_status_check',
    'deal_status_changes_reason_required',
    'deal_status_changes_to_status_check',
    'deal_status_changes_creation_key',
    'deal_status_changes_deal_id_id_idx',
    'deal_status_changes_deal_id_fkey',
  ],
  invoices: [
    'invoices_pkey',
    'invoices_amount_positive',
    'invoices_dates_ordered',
    'invoices_number_format',
    'invoices_paid_at_matches_status',
    'invoices_status_check',
    'invoices_deal_id_key',
    'invoices_number_key',
    'invoices_issued_expires_at_idx',
    'invoices_deal_id_fkey',
  ],
  top_ups: [
    'top_ups_pkey',
    'top_ups_amount_positive',
    'top_ups_bank_reference_normalized',
    'top_ups_bank_reference_key',
    'top_ups_company_id_fkey',
    'top_ups_invoice_id_fkey',
  ],
  corrections: [
    'corrections_pkey',
    'corrections_amount_not_zero',
    'corrections_reason_length',
    'corrections_idempotency_key_key',
    'corrections_company_id_fkey',
    'corrections_top_up_id_fkey',
  ],
  ledger_transfers: [
    'ledger_transfers_pkey',
    'ledger_transfers_actor_ref_matches_type',
    'ledger_transfers_actor_type_check',
    'ledger_transfers_correction_matches_type',
    'ledger_transfers_deal_matches_type',
    'ledger_transfers_entry_count_min',
    'ledger_transfers_invoice_matches_type',
    'ledger_transfers_one_source',
    'ledger_transfers_top_up_matches_type',
    'ledger_transfers_type_check',
    'ledger_transfers_correction_id_key',
    'ledger_transfers_top_up_id_key',
    'ledger_transfers_deal_settlement_key',
    'ledger_transfers_invoice_payment_key',
    'ledger_transfers_correction_id_fkey',
    'ledger_transfers_deal_id_fkey',
    'ledger_transfers_invoice_id_fkey',
    'ledger_transfers_top_up_id_fkey',
  ],
  ledger_entries: [
    'ledger_entries_pkey',
    'ledger_entries_amount_not_zero',
    'ledger_entries_account_id_id_idx',
    'ledger_entries_transfer_id_idx',
    'ledger_entries_account_id_fkey',
    'ledger_entries_transfer_id_fkey',
  ],
};

async function buildMetadata(): Promise<EntityMetadata[]> {
  const dataSource = new MetadataDataSource({
    ...buildTypeOrmOptions('postgres://metadata-only'),
    entities: entityClasses(),
  });
  await dataSource.build();
  return dataSource.entityMetadatas;
}

describe('marketplace entities', () => {
  it('declare exactly the 13 tables, each with its named rules', async () => {
    const entityMetadatas = await buildMetadata();

    const actual = Object.fromEntries(
      entityMetadatas.map((metadata) => [
        metadata.tableName,
        ruleNames(metadata),
      ]),
    );
    const expected = Object.fromEntries(
      Object.entries(EXPECTED_RULES).map(([table, names]) => [
        table,
        [...names].sort(),
      ]),
    );
    expect(actual).toEqual(expected);
  });

  it('use SQL expressions as the defaults of generated columns', async () => {
    const defaults = Object.fromEntries(
      (await buildMetadata()).flatMap((metadata) =>
        metadata.columns
          .filter((column) => typeof column.default === 'function')
          .map((column) => [
            `${metadata.tableName}.${column.databaseName}`,
            (column.default as () => string)(),
          ]),
      ),
    );
    // Explicit defaults, plus the now() that TypeORM adds to every
    // @CreateDateColumn and @UpdateDateColumn.
    expect(defaults).toEqual({
      'accounts.created_at': 'now()',
      'companies.created_at': 'now()',
      'companies.updated_at': 'now()',
      'corrections.created_at': 'now()',
      'deal_status_changes.changed_at': 'now()',
      'deals.created_at': 'now()',
      'deals.updated_at': 'now()',
      'invoices.number': 'next_invoice_number()',
      'ledger_entries.created_at': 'now()',
      'ledger_transfers.created_at': 'now()',
      'lot_photos.uploaded_at': 'now()',
      'lot_price_changes.changed_at': 'now()',
      'lots.created_at': 'now()',
      'lots.updated_at': 'now()',
      'platform_settings.updated_at': 'now()',
      'top_ups.recorded_at': 'now()',
    });
  });
});
