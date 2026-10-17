# Contract: Schema Rules

Every database rule of this feature, by name. Later services rely on these names: a `QueryFailedError` carries the name in `driverError.constraint`, and a service maps it to a user error (for example `deals_buyer_company_id_fkey` to "Activate your wallet first"). A name changes only together with this file and its test.

This list is also the traceability list of SC-001. Each rule has a "breaks" test and a "passes" test in the named test file:

- **C** = `test/schema/catalog-deals.e2e-spec.ts`
- **M** = `test/schema/money.e2e-spec.ts`

Required-column (`NOT NULL`) violations have no constraint name in PostgreSQL. Tests assert them by `driverError.column` with code `23502`, one test per table that omits each required column in turn.

## companies (C)

| Rule                                | Kind         | Definition                                                         | Spec   |
| ----------------------------------- | ------------ | ------------------------------------------------------------------ | ------ |
| `companies_name_length`             | check        | `char_length(name) BETWEEN 1 AND 300`                              | FR-005 |
| `companies_registration_number_key` | unique       | `(registration_number)`                                            | FR-005 |
| `companies_email_format`            | check        | `char_length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'`        | FR-005 |
| `companies_email_lower_key`         | unique index | `(lower(email))`                                                   | FR-005 |
| required                            | not null     | `name`, `registration_number`, `email`, `created_at`, `updated_at` | FR-004 |

## accounts (M)

| Rule                                  | Kind         | Definition                                               | Spec   |
| ------------------------------------- | ------------ | -------------------------------------------------------- | ------ |
| `accounts_type_check`                 | check        | `type IN ('company_wallet', 'escrow', 'bank_clearing')`  | FR-006 |
| `accounts_company_matches_type`       | check        | `(type = 'company_wallet') = (company_id IS NOT NULL)`   | FR-006 |
| `accounts_company_id_key`             | unique       | `(company_id)`; target of the wallet foreign keys        | FR-006 |
| `accounts_company_id_fkey`            | foreign key  | `→ companies (id) ON DELETE RESTRICT`                    | FR-006 |
| `accounts_platform_type_key`          | unique index | `(type) WHERE type <> 'company_wallet'`                  | FR-006 |
| `accounts_balance_not_negative`       | check        | `type = 'bank_clearing' OR balance_minor >= 0`           | FR-006 |
| `accounts_bank_clearing_not_positive` | check        | `type <> 'bank_clearing' OR balance_minor <= 0`          | FR-006 |
| `accounts_identity_immutable`         | trigger      | rejects `DELETE`, and `UPDATE` of `type` or `company_id` | FR-006 |
| required                              | not null     | `type`, `balance_minor`, `created_at`                    | FR-004 |
| seed                                  | data         | exactly one `escrow` and one `bank_clearing`, balance 0  | FR-003 |

## platform_settings (C)

| Rule                                               | Kind     | Definition                           | Spec   |
| -------------------------------------------------- | -------- | ------------------------------------ | ------ |
| `platform_settings_single_row`                     | check    | `id = 1`                             | FR-017 |
| `platform_settings_payment_window_days_check`      | check    | `payment_window_days >= 1`           | FR-017 |
| `platform_settings_grace_period_days_check`        | check    | `grace_period_days >= 0`             | FR-017 |
| `platform_settings_max_unpaid_deals_check`         | check    | `max_unpaid_deals >= 1`              | FR-017 |
| `platform_settings_expiry_limit_check`             | check    | `expiry_limit >= 1`                  | FR-017 |
| `platform_settings_expiry_lookback_days_check`     | check    | `expiry_lookback_days >= 1`          | FR-017 |
| `platform_settings_confirmation_window_days_check` | check    | `confirmation_window_days >= 1`      | FR-017 |
| required                                           | not null | every column except `updated_by_ref` | FR-004 |
| seed                                               | data     | one row with 5, 1, 3, 2, 30, 14      | FR-003 |

## lots (C)

| Rule                            | Kind        | Definition                                            | Spec    |
| ------------------------------- | ----------- | ----------------------------------------------------- | ------- |
| `lots_seller_company_id_fkey`   | foreign key | `(seller_company_id) → accounts (company_id)`         | FR-006a |
| `lots_title_length`             | check       | `char_length(title) BETWEEN 1 AND 200`                | FR-007  |
| `lots_unit_price_positive`      | check       | `unit_price_minor > 0`                                | FR-007  |
| `lots_stock_not_negative`       | check       | `stock_available >= 0`                                | FR-007  |
| `lots_status_check`             | check       | `status IN ('hidden', 'published')`, default `hidden` | FR-007  |
| `lots_id_seller_company_id_key` | unique      | `(id, seller_company_id)`                             | FR-007  |
| `lots_seller_company_id_idx`    | index       | `(seller_company_id)`                                 | FR-019  |
| `lots_published_created_at_idx` | index       | `(created_at) WHERE status = 'published'`             | FR-019  |
| required                        | not null    | every column                                          | FR-004  |

## lot_photos (C)

| Rule                                  | Kind        | Definition                                                  | Spec   |
| ------------------------------------- | ----------- | ----------------------------------------------------------- | ------ |
| `lot_photos_lot_id_fkey`              | foreign key | `→ lots (id) ON DELETE CASCADE`                             | FR-008 |
| `lot_photos_storage_key_key`          | unique      | `(storage_key)`                                             | FR-008 |
| `lot_photos_original_filename_length` | check       | `char_length(original_filename) BETWEEN 1 AND 255`          | FR-008 |
| `lot_photos_content_type_check`       | check       | `content_type IN ('image/jpeg', 'image/png', 'image/webp')` | FR-008 |
| `lot_photos_size_bytes_positive`      | check       | `size_bytes > 0`                                            | FR-008 |
| `lot_photos_width_px_positive`        | check       | `width_px > 0`                                              | FR-008 |
| `lot_photos_height_px_positive`       | check       | `height_px > 0`                                             | FR-008 |
| `lot_photos_position_not_negative`    | check       | `position >= 0`                                             | FR-008 |
| `lot_photos_lot_id_position_key`      | unique      | `(lot_id, position) DEFERRABLE INITIALLY DEFERRED`          | FR-008 |
| required                              | not null    | every column                                                | FR-004 |

## lot_price_changes (C)

| Rule                                   | Kind         | Definition                                                                | Spec    |
| -------------------------------------- | ------------ | ------------------------------------------------------------------------- | ------- |
| `lot_price_changes_lot_id_fkey`        | foreign key  | `→ lots (id) ON DELETE CASCADE`                                           | FR-010a |
| `lot_price_changes_old_price_positive` | check        | `old_price_minor IS NULL OR old_price_minor > 0`                          | FR-010a |
| `lot_price_changes_new_price_positive` | check        | `new_price_minor > 0`                                                     | FR-010a |
| `lot_price_changes_price_changed`      | check        | `old_price_minor IS DISTINCT FROM new_price_minor`                        | FR-010a |
| `lot_price_changes_actor_type_check`   | check        | `actor_type IN ('seller', 'operator')`                                    | FR-010a |
| `lot_price_changes_creation_key`       | unique index | `(lot_id) WHERE old_price_minor IS NULL`                                  | FR-010a |
| `lot_price_changes_lot_id_id_idx`      | index        | `(lot_id, id)`                                                            | FR-010a |
| `lot_price_changes_append_only`        | trigger      | rejects `UPDATE`; rejects `DELETE` unless it comes from the lot's cascade | FR-010a |
| required                               | not null     | every column except `old_price_minor`                                     | FR-004  |

## deals (C)

| Rule                                    | Kind        | Definition                                                                              | Spec    |
| --------------------------------------- | ----------- | --------------------------------------------------------------------------------------- | ------- |
| `deals_buyer_company_id_fkey`           | foreign key | `(buyer_company_id) → accounts (company_id)`                                            | FR-006a |
| `deals_seller_company_id_fkey`          | foreign key | `(seller_company_id) → accounts (company_id)`                                           | FR-006a |
| `deals_lot_seller_fkey`                 | foreign key | `(lot_id, seller_company_id) → lots (id, seller_company_id) ON DELETE RESTRICT`         | FR-009  |
| `deals_quantity_positive`               | check       | `quantity >= 1`                                                                         | FR-009  |
| `deals_unit_price_positive`             | check       | `unit_price_minor > 0`                                                                  | FR-009  |
| `deals_total_matches`                   | check       | `total_minor = quantity * unit_price_minor`                                             | FR-009  |
| `deals_buyer_not_seller`                | check       | `buyer_company_id <> seller_company_id`                                                 | FR-009  |
| `deals_status_check`                    | check       | `status IN` the 8 deal statuses                                                         | FR-009  |
| `deals_shipped_has_deadline`            | check       | `(status IN ('shipped', 'disputed', 'completed')) <= (confirmation_due_at IS NOT NULL)` | FR-009  |
| `deals_buyer_idempotency_key_key`       | unique      | `(buyer_company_id, idempotency_key)`                                                   | FR-009  |
| `deals_buyer_company_id_status_idx`     | index       | `(buyer_company_id, status)`                                                            | FR-019  |
| `deals_seller_company_id_status_idx`    | index       | `(seller_company_id, status)`                                                           | FR-019  |
| `deals_lot_id_idx`                      | index       | `(lot_id)`                                                                              | FR-019  |
| `deals_shipped_confirmation_due_at_idx` | index       | `(confirmation_due_at) WHERE status = 'shipped'`                                        | FR-019  |
| required                                | not null    | every column except `confirmation_due_at`                                               | FR-004  |

## deal_status_changes (C)

| Rule                                         | Kind         | Definition                                                                                  | Spec   |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- | ------ |
| `deal_status_changes_deal_id_fkey`           | foreign key  | `→ deals (id)`                                                                              | FR-010 |
| `deal_status_changes_from_status_check`      | check        | `from_status IS NULL OR from_status IN` the 8 statuses                                      | FR-010 |
| `deal_status_changes_to_status_check`        | check        | `to_status IN` the 8 statuses                                                               | FR-010 |
| `deal_status_changes_creation_key`           | unique index | `(deal_id) WHERE from_status IS NULL`                                                       | FR-010 |
| `deal_status_changes_actor_type_check`       | check        | `actor_type IN ('buyer', 'seller', 'operator', 'system')`                                   | FR-010 |
| `deal_status_changes_actor_ref_matches_type` | check        | `(actor_type = 'system') = (actor_ref IS NULL)`                                             | FR-010 |
| `deal_status_changes_reason_required`        | check        | `to_status NOT IN ('disputed', 'refunded') OR (reason IS NOT NULL AND btrim(reason) <> '')` | FR-010 |
| `deal_status_changes_deal_id_id_idx`         | index        | `(deal_id, id)`                                                                             | FR-019 |
| `deal_status_changes_append_only`            | trigger      | rejects `UPDATE` and `DELETE`                                                               | FR-010 |
| required                                     | not null     | `deal_id`, `to_status`, `actor_type`, `changed_at`                                          | FR-004 |

## invoices (C)

| Rule                              | Kind        | Definition                                             | Spec   |
| --------------------------------- | ----------- | ------------------------------------------------------ | ------ |
| `invoices_deal_id_fkey`           | foreign key | `→ deals (id)`                                         | FR-011 |
| `invoices_deal_id_key`            | unique      | `(deal_id)`                                            | FR-011 |
| `invoices_number_key`             | unique      | `(number)`; default `next_invoice_number()`            | FR-011 |
| `invoices_number_format`          | check       | `number ~ '^INV-[0-9]{4}-[0-9]{6,}$'`                  | FR-011 |
| `invoices_amount_positive`        | check       | `amount_minor > 0`                                     | FR-011 |
| `invoices_status_check`           | check       | `status IN ('issued', 'paid', 'cancelled', 'expired')` | FR-011 |
| `invoices_dates_ordered`          | check       | `issued_at <= due_at AND due_at <= expires_at`         | FR-011 |
| `invoices_paid_at_matches_status` | check       | `(status = 'paid') = (paid_at IS NOT NULL)`            | FR-011 |
| `invoices_issued_expires_at_idx`  | index       | `(expires_at) WHERE status = 'issued'`                 | FR-019 |
| required                          | not null    | every column except `paid_at`                          | FR-004 |

## top_ups (M)

| Rule                                | Kind        | Definition                                  | Spec    |
| ----------------------------------- | ----------- | ------------------------------------------- | ------- |
| `top_ups_company_id_fkey`           | foreign key | `(company_id) → accounts (company_id)`      | FR-006a |
| `top_ups_invoice_id_fkey`           | foreign key | `→ invoices (id)`                           | FR-015  |
| `top_ups_amount_positive`           | check       | `amount_minor > 0`                          | FR-015  |
| `top_ups_bank_reference_key`        | unique      | `(bank_reference)`                          | FR-015  |
| `top_ups_bank_reference_normalized` | check       | `bank_reference ~ '^[A-Z0-9/?:().,''+-]+$'` | FR-015  |
| required                            | not null    | every column except `invoice_id`            | FR-004  |

## corrections (M)

| Rule                              | Kind        | Definition                               | Spec    |
| --------------------------------- | ----------- | ---------------------------------------- | ------- |
| `corrections_company_id_fkey`     | foreign key | `(company_id) → accounts (company_id)`   | FR-006a |
| `corrections_top_up_id_fkey`      | foreign key | `→ top_ups (id)`                         | FR-016  |
| `corrections_amount_not_zero`     | check       | `amount_minor <> 0`                      | FR-016  |
| `corrections_reason_length`       | check       | `char_length(reason) BETWEEN 1 AND 1000` | FR-016  |
| `corrections_idempotency_key_key` | unique      | `(idempotency_key)`                      | FR-016  |
| required                          | not null    | every column except `top_up_id`          | FR-004  |

## ledger_transfers (M)

| Rule                                       | Kind             | Definition                                                                                                                                                                                                                                                                                                                                                                                                            | Spec   |
| ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `ledger_transfers_type_check`              | check            | `type IN ('top_up', 'invoice_payment', 'payout', 'refund', 'correction')`                                                                                                                                                                                                                                                                                                                                             | FR-012 |
| `ledger_transfers_one_source`              | check            | `num_nonnulls(top_up_id, invoice_id, deal_id, correction_id) = 1`                                                                                                                                                                                                                                                                                                                                                     | FR-012 |
| `ledger_transfers_top_up_matches_type`     | check            | `(type = 'top_up') = (top_up_id IS NOT NULL)`                                                                                                                                                                                                                                                                                                                                                                         | FR-012 |
| `ledger_transfers_invoice_matches_type`    | check            | `(type = 'invoice_payment') = (invoice_id IS NOT NULL)`                                                                                                                                                                                                                                                                                                                                                               | FR-012 |
| `ledger_transfers_deal_matches_type`       | check            | `(type IN ('payout', 'refund')) = (deal_id IS NOT NULL)`                                                                                                                                                                                                                                                                                                                                                              | FR-012 |
| `ledger_transfers_correction_matches_type` | check            | `(type = 'correction') = (correction_id IS NOT NULL)`                                                                                                                                                                                                                                                                                                                                                                 | FR-012 |
| `ledger_transfers_top_up_id_fkey`          | foreign key      | `→ top_ups (id)`                                                                                                                                                                                                                                                                                                                                                                                                      | FR-012 |
| `ledger_transfers_invoice_id_fkey`         | foreign key      | `→ invoices (id)`                                                                                                                                                                                                                                                                                                                                                                                                     | FR-012 |
| `ledger_transfers_deal_id_fkey`            | foreign key      | `→ deals (id)`                                                                                                                                                                                                                                                                                                                                                                                                        | FR-012 |
| `ledger_transfers_correction_id_fkey`      | foreign key      | `→ corrections (id)`                                                                                                                                                                                                                                                                                                                                                                                                  | FR-012 |
| `ledger_transfers_top_up_id_key`           | unique           | `(top_up_id)`                                                                                                                                                                                                                                                                                                                                                                                                         | FR-012 |
| `ledger_transfers_correction_id_key`       | unique           | `(correction_id)`                                                                                                                                                                                                                                                                                                                                                                                                     | FR-012 |
| `ledger_transfers_invoice_payment_key`     | unique index     | `(invoice_id) WHERE type = 'invoice_payment'`                                                                                                                                                                                                                                                                                                                                                                         | FR-012 |
| `ledger_transfers_deal_settlement_key`     | unique index     | `(deal_id) WHERE type IN ('payout', 'refund')`                                                                                                                                                                                                                                                                                                                                                                        | FR-012 |
| `ledger_transfers_actor_type_check`        | check            | `actor_type IN ('buyer', 'seller', 'operator', 'system')`                                                                                                                                                                                                                                                                                                                                                             | FR-012 |
| `ledger_transfers_entry_count_min`         | check            | `entry_count >= 2`                                                                                                                                                                                                                                                                                                                                                                                                    | FR-013 |
| `ledger_transfers_actor_ref_matches_type`  | check            | `(actor_type = 'system') = (actor_ref IS NULL)`                                                                                                                                                                                                                                                                                                                                                                       | FR-012 |
| `ledger_transfers_balanced`                | deferred trigger | at commit: the transfer has exactly `entry_count` entries and they sum to 0. One rule name, raised by two deferred triggers that share `check_transfer_balanced()`: `ledger_transfers_balanced` on `ledger_transfers` (catches a transfer with missing entries) and `ledger_entries_balanced` on `ledger_entries` (catches entries added to a committed transfer, even a balanced pair, because they break the count) | FR-013 |
| `ledger_transfers_append_only`             | trigger          | rejects `UPDATE` and `DELETE`                                                                                                                                                                                                                                                                                                                                                                                         | FR-014 |
| `ledger_transfers_no_truncate`             | trigger          | rejects `TRUNCATE`                                                                                                                                                                                                                                                                                                                                                                                                    | FR-014 |
| required                                   | not null         | `type`, `actor_type`, `entry_count`, `created_at`                                                                                                                                                                                                                                                                                                                                                                     | FR-004 |

## ledger_entries (M)

| Rule                               | Kind        | Definition                       | Spec   |
| ---------------------------------- | ----------- | -------------------------------- | ------ |
| `ledger_entries_transfer_id_fkey`  | foreign key | `→ ledger_transfers (id)`        | FR-013 |
| `ledger_entries_account_id_fkey`   | foreign key | `→ accounts (id)`                | FR-013 |
| `ledger_entries_amount_not_zero`   | check       | `amount_minor <> 0`              | FR-013 |
| `ledger_entries_append_only`       | trigger     | rejects `UPDATE` and `DELETE`    | FR-014 |
| `ledger_entries_no_truncate`       | trigger     | rejects `TRUNCATE`               | FR-014 |
| `ledger_entries_transfer_id_idx`   | index       | `(transfer_id)`, for the trigger | R7     |
| `ledger_entries_account_id_id_idx` | index       | `(account_id, id)`               | FR-019 |
| required                           | not null    | every column                     | FR-004 |

## Backup rules

PostgreSQL tests `CHECK` constraints in alphabetical order of their names and reports the first one that fails. Two rules back up others and are never reported alone: `ledger_transfers_type_check` (an unknown type matches no source, so `ledger_transfers_one_source` fails first) and `ledger_transfers_top_up_matches_type` (a mismatched top-up source always breaks another `*_matches_type` rule that sorts before it). Their tests assert that the write is rejected by one of the rules involved.

## Not database rules

These rules from data-model.md stay with the later services and have no test here: allowed status transitions, balance equals the sum of entries, `invoices.amount_minor` equals `deals.total_minor`, `lots.unit_price_minor` equals the newest price change, stock reservation, the unpaid and prepay-only limits.
