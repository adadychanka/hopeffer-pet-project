// Story 2: the database itself rejects bad company, settings, catalog and deal
// data. Every rule of contracts/schema-rules.md for these tables has a test
// that breaks it (asserting the rule name) and a test that passes it.
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createDealSetup,
  createInvoice,
  createLot,
  createWallet,
  expectNotNull,
  expectRequiredColumns,
  expectRule,
  insertRow,
  openTestDataSource,
  rolledBack,
  unique,
} from './helpers.js';

let db: DataSource;

beforeAll(async () => {
  db = await openTestDataSource();
});

afterAll(async () => {
  await db.destroy();
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe('companies', () => {
  const companyRow = () =>
    Promise.resolve({
      name: 'Acme',
      registration_number: unique('REG'),
      email: `${unique('acme')}@test.example`,
    });

  it('stores a valid company', async () => {
    const row = await insertRow(db, 'companies', await companyRow());
    expect(row.id).toEqual(expect.any(String));
  });

  it.each(['', 'x'.repeat(301)])(
    'rejects the name %j (companies_name_length)',
    async (name) => {
      await expectRule(
        insertRow(db, 'companies', { ...(await companyRow()), name }),
        'companies_name_length',
      );
    },
  );

  it('rejects a second company with the same registration number', async () => {
    const row = await companyRow();
    await insertRow(db, 'companies', row);
    await expectRule(
      insertRow(db, 'companies', {
        ...row,
        email: `${unique('other')}@test.example`,
      }),
      'companies_registration_number_key',
    );
  });

  it.each([`${'a'.repeat(242)}@test.example`, 'a@', '@b', 'a b@c', 'a@b@c'])(
    'rejects the email %j (companies_email_format)',
    async (email) => {
      await expectRule(
        insertRow(db, 'companies', { ...(await companyRow()), email }),
        'companies_email_format',
      );
    },
  );

  it('treats emails that differ only in letter case as the same address', async () => {
    const local = unique('sales');
    await insertRow(db, 'companies', {
      ...(await companyRow()),
      email: `${local.toUpperCase()}@Acme.test`,
    });
    await expectRule(
      insertRow(db, 'companies', {
        ...(await companyRow()),
        email: `${local}@acme.test`,
      }),
      'companies_email_lower_key',
    );
  });

  it('requires every column', async () => {
    await expectRequiredColumns(db, 'companies', companyRow, [
      'name',
      'registration_number',
      'email',
      'created_at',
      'updated_at',
    ]);
  });
});

describe('platform_settings', () => {
  it('accepts a valid change of a setting', async () => {
    const rows = await rolledBack(db, (tx) =>
      tx.query(
        'UPDATE platform_settings SET payment_window_days = 7 RETURNING payment_window_days',
      ),
    );
    expect(rows).toEqual([[{ payment_window_days: 7 }], 1]);
  });

  it('allows only the single row with id 1', async () => {
    await expectRule(
      rolledBack(db, (tx) =>
        tx.query('INSERT INTO platform_settings (id) VALUES (2)'),
      ),
      'platform_settings_single_row',
    );
  });

  it.each([
    ['payment_window_days', 0],
    ['grace_period_days', -1],
    ['max_unpaid_deals', 0],
    ['expiry_limit', 0],
    ['expiry_lookback_days', 0],
    ['confirmation_window_days', 0],
  ])('rejects %s = %d', async (column, value) => {
    await expectRule(
      rolledBack(db, (tx) =>
        tx.query(`UPDATE platform_settings SET "${column}" = $1`, [value]),
      ),
      `platform_settings_${column}_check`,
    );
  });

  it.each([
    'payment_window_days',
    'grace_period_days',
    'max_unpaid_deals',
    'expiry_limit',
    'expiry_lookback_days',
    'confirmation_window_days',
    'updated_at',
  ])('requires %s', async (column) => {
    await expectNotNull(
      rolledBack(db, (tx) =>
        tx.query(`UPDATE platform_settings SET "${column}" = NULL`),
      ),
      column,
    );
  });
});

describe('lots', () => {
  const lotRow = async () => {
    const seller = await createCompany(db);
    return {
      seller_company_id: seller.id,
      title: 'Excavator',
      unit_price_minor: 100_000,
      stock_available: 5,
    };
  };

  it('stores a valid lot, hidden by default', async () => {
    const row = await insertRow(db, 'lots', await lotRow());
    expect(row.status).toBe('hidden');
  });

  it.each(['', 'x'.repeat(201)])(
    'rejects the title %j (lots_title_length)',
    async (title) => {
      await expectRule(
        insertRow(db, 'lots', { ...(await lotRow()), title }),
        'lots_title_length',
      );
    },
  );

  it('rejects a unit price of 0', async () => {
    await expectRule(
      insertRow(db, 'lots', { ...(await lotRow()), unit_price_minor: 0 }),
      'lots_unit_price_positive',
    );
  });

  it('rejects a negative stock', async () => {
    await expectRule(
      insertRow(db, 'lots', { ...(await lotRow()), stock_available: -1 }),
      'lots_stock_not_negative',
    );
  });

  it('rejects an unknown status', async () => {
    await expectRule(
      insertRow(db, 'lots', { ...(await lotRow()), status: 'archived' }),
      'lots_status_check',
    );
  });

  it('keeps (id, seller_company_id) unique as the target of the deal key', async () => {
    // The pair cannot be duplicated without breaking lots_pkey first, so the
    // test checks that the constraint exists; the deals tests use it.
    const rows = await db.query<{ definition: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conname = 'lots_id_seller_company_id_key'`,
    );
    expect(rows).toEqual([{ definition: 'UNIQUE (id, seller_company_id)' }]);
  });

  it('needs the seller wallet, and accepts the lot once the wallet exists (Story 2 scenario 7)', async () => {
    const seller = await createCompany(db, { wallet: false });
    const row = { ...(await lotRow()), seller_company_id: seller.id };
    await expectRule(insertRow(db, 'lots', row), 'lots_seller_company_id_fkey');
    await createWallet(db, seller.id);
    await expect(insertRow(db, 'lots', row)).resolves.toMatchObject({
      seller_company_id: seller.id,
    });
  });

  it('requires every column', async () => {
    await expectRequiredColumns(db, 'lots', lotRow, [
      'seller_company_id',
      'title',
      'unit_price_minor',
      'stock_available',
      'status',
      'created_at',
      'updated_at',
    ]);
  });
});

describe('lot_photos', () => {
  const photoRow = async (lotId?: string) => {
    const lot = lotId ?? (await createLot(db, (await createCompany(db)).id));
    return {
      lot_id: lot,
      storage_key: unique('lots/photo'),
      original_filename: 'front.jpg',
      content_type: 'image/jpeg',
      size_bytes: 1024,
      width_px: 800,
      height_px: 600,
      position: 0,
    };
  };

  it('stores a valid photo', async () => {
    const row = await insertRow(db, 'lot_photos', await photoRow());
    expect(row.uploaded_at).toBeInstanceOf(Date);
  });

  it('rejects a second photo with the same storage key', async () => {
    const row = await photoRow();
    await insertRow(db, 'lot_photos', row);
    await expectRule(
      insertRow(db, 'lot_photos', { ...row, position: 1 }),
      'lot_photos_storage_key_key',
    );
  });

  it.each(['', 'x'.repeat(256)])(
    'rejects the file name %j',
    async (original_filename) => {
      await expectRule(
        insertRow(db, 'lot_photos', {
          ...(await photoRow()),
          original_filename,
        }),
        'lot_photos_original_filename_length',
      );
    },
  );

  it('rejects a content type outside the image list', async () => {
    await expectRule(
      insertRow(db, 'lot_photos', {
        ...(await photoRow()),
        content_type: 'image/gif',
      }),
      'lot_photos_content_type_check',
    );
  });

  it.each([
    ['size_bytes', 'lot_photos_size_bytes_positive'],
    ['width_px', 'lot_photos_width_px_positive'],
    ['height_px', 'lot_photos_height_px_positive'],
  ])('rejects %s = 0', async (column, rule) => {
    await expectRule(
      insertRow(db, 'lot_photos', { ...(await photoRow()), [column]: 0 }),
      rule,
    );
  });

  it('belongs only to an existing lot', async () => {
    await expectRule(
      insertRow(db, 'lot_photos', {
        ...(await photoRow()),
        lot_id: randomUUID(),
      }),
      'lot_photos_lot_id_fkey',
    );
  });

  it('rejects a negative position', async () => {
    await expectRule(
      insertRow(db, 'lot_photos', { ...(await photoRow()), position: -1 }),
      'lot_photos_position_not_negative',
    );
  });

  it('reorders photos in one transaction, because the position rule is checked at commit (Story 2 scenario 4)', async () => {
    const lotId = await createLot(db, (await createCompany(db)).id);
    const first = await insertRow(db, 'lot_photos', await photoRow(lotId));
    const second = await insertRow(db, 'lot_photos', {
      ...(await photoRow(lotId)),
      position: 1,
    });
    const swap = async (immediate: boolean) =>
      db.transaction(async (tx) => {
        if (immediate) await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
        await tx.query('UPDATE lot_photos SET position = 1 WHERE id = $1', [
          first.id,
        ]);
        await tx.query('UPDATE lot_photos SET position = 0 WHERE id = $1', [
          second.id,
        ]);
      });

    await expectRule(swap(true), 'lot_photos_lot_id_position_key');
    await expect(swap(false)).resolves.toBeUndefined();
  });

  it('deletes the photos of a lot without deals together with the lot (Story 2 scenario 3)', async () => {
    const lotId = await createLot(db, (await createCompany(db)).id);
    await insertRow(db, 'lot_photos', await photoRow(lotId));
    await db.query('DELETE FROM lots WHERE id = $1', [lotId]);
    expect(
      await db.query('SELECT id FROM lot_photos WHERE lot_id = $1', [lotId]),
    ).toEqual([]);
  });

  it('requires every column', async () => {
    await expectRequiredColumns(db, 'lot_photos', photoRow, [
      'lot_id',
      'storage_key',
      'original_filename',
      'content_type',
      'size_bytes',
      'width_px',
      'height_px',
      'position',
      'uploaded_at',
    ]);
  });
});

describe('lot_price_changes', () => {
  const lotWithCreationRow = async () => {
    const lotId = await createLot(db, (await createCompany(db)).id);
    const creation = await insertRow(db, 'lot_price_changes', {
      lot_id: lotId,
      old_price_minor: null,
      new_price_minor: 100_000,
      actor_type: 'seller',
      actor_ref: 'seller-1',
    });
    return { lotId, creation };
  };
  const changeRow = async () => ({
    lot_id: (await lotWithCreationRow()).lotId,
    old_price_minor: 100_000,
    new_price_minor: 120_000,
    actor_type: 'seller',
    actor_ref: 'seller-1',
  });

  it('stores the creation row and a later price change', async () => {
    const { creation } = await lotWithCreationRow();
    expect(creation.old_price_minor).toBeNull();
    await expect(
      insertRow(db, 'lot_price_changes', await changeRow()),
    ).resolves.toMatchObject({ new_price_minor: '120000' });
  });

  it('rejects a second creation row for the same lot', async () => {
    const { lotId } = await lotWithCreationRow();
    await expectRule(
      insertRow(db, 'lot_price_changes', {
        ...(await changeRow()),
        lot_id: lotId,
        old_price_minor: null,
      }),
      'lot_price_changes_creation_key',
    );
  });

  it('rejects a change that keeps the same price', async () => {
    await expectRule(
      insertRow(db, 'lot_price_changes', {
        ...(await changeRow()),
        new_price_minor: 100_000,
      }),
      'lot_price_changes_price_changed',
    );
  });

  it('rejects a new price of 0', async () => {
    await expectRule(
      insertRow(db, 'lot_price_changes', {
        ...(await changeRow()),
        new_price_minor: 0,
      }),
      'lot_price_changes_new_price_positive',
    );
  });

  it('rejects an old price of 0', async () => {
    await expectRule(
      insertRow(db, 'lot_price_changes', {
        ...(await changeRow()),
        old_price_minor: 0,
      }),
      'lot_price_changes_old_price_positive',
    );
  });

  it('belongs only to an existing lot', async () => {
    await expectRule(
      insertRow(db, 'lot_price_changes', {
        ...(await changeRow()),
        lot_id: randomUUID(),
      }),
      'lot_price_changes_lot_id_fkey',
    );
  });

  it('rejects a buyer as the actor', async () => {
    await expectRule(
      insertRow(db, 'lot_price_changes', {
        ...(await changeRow()),
        actor_type: 'buyer',
      }),
      'lot_price_changes_actor_type_check',
    );
  });

  it('never changes a history row, and deletes it only with its lot (Story 2 scenario 8)', async () => {
    const { lotId, creation } = await lotWithCreationRow();
    await expectRule(
      db.query(
        'UPDATE lot_price_changes SET new_price_minor = 1 WHERE id = $1',
        [creation.id],
      ),
      'lot_price_changes_append_only',
    );
    await expectRule(
      db.query('DELETE FROM lot_price_changes WHERE id = $1', [creation.id]),
      'lot_price_changes_append_only',
    );

    await db.query('DELETE FROM lots WHERE id = $1', [lotId]);
    expect(
      await db.query('SELECT id FROM lot_price_changes WHERE lot_id = $1', [
        lotId,
      ]),
    ).toEqual([]);
  });

  it('requires every column except the old price', async () => {
    await expectRequiredColumns(db, 'lot_price_changes', changeRow, [
      'lot_id',
      'new_price_minor',
      'actor_type',
      'actor_ref',
      'changed_at',
    ]);
  });
});

describe('deals', () => {
  const dealRow = async () => {
    const buyer = await createCompany(db);
    const seller = await createCompany(db);
    const lotId = await createLot(db, seller.id);
    return {
      lot_id: lotId,
      buyer_company_id: buyer.id,
      seller_company_id: seller.id,
      quantity: 3,
      unit_price_minor: 100_000,
      total_minor: 300_000,
      status: 'awaiting_payment',
      idempotency_key: randomUUID(),
    };
  };

  it('stores a valid deal', async () => {
    await expect(
      insertRow(db, 'deals', await dealRow()),
    ).resolves.toMatchObject({
      total_minor: '300000',
      confirmation_due_at: null,
    });
  });

  it('rejects a company buying its own lot (Story 2 scenario 1)', async () => {
    const row = await dealRow();
    await expectRule(
      insertRow(db, 'deals', {
        ...row,
        buyer_company_id: row.seller_company_id,
      }),
      'deals_buyer_not_seller',
    );
  });

  it('rejects a seller that does not own the lot (Story 2 scenario 2)', async () => {
    const otherSeller = await createCompany(db);
    await expectRule(
      insertRow(db, 'deals', {
        ...(await dealRow()),
        seller_company_id: otherSeller.id,
      }),
      'deals_lot_seller_fkey',
    );
  });

  it('keeps a lot with a deal from being deleted (Story 2 scenario 3)', async () => {
    const { lotId } = await createDealSetup(db);
    await expectRule(
      db.query('DELETE FROM lots WHERE id = $1', [lotId]),
      'deals_lot_seller_fkey',
    );
  });

  it('needs the buyer wallet, and accepts the deal once the wallet exists (Story 2 scenario 7)', async () => {
    const buyer = await createCompany(db, { wallet: false });
    const row = { ...(await dealRow()), buyer_company_id: buyer.id };
    await expectRule(
      insertRow(db, 'deals', row),
      'deals_buyer_company_id_fkey',
    );
    await createWallet(db, buyer.id);
    await expect(insertRow(db, 'deals', row)).resolves.toMatchObject({
      buyer_company_id: buyer.id,
    });
  });

  it('needs the seller wallet', async () => {
    // A lot needs its seller's wallet, so this is the second guard: a seller
    // without a wallet is rejected even before the lot match is checked.
    const seller = await createCompany(db, { wallet: false });
    await expectRule(
      insertRow(db, 'deals', {
        ...(await dealRow()),
        seller_company_id: seller.id,
      }),
      'deals_seller_company_id_fkey',
    );
  });

  it('rejects a quantity of 0', async () => {
    await expectRule(
      insertRow(db, 'deals', {
        ...(await dealRow()),
        quantity: 0,
        total_minor: 0,
      }),
      'deals_quantity_positive',
    );
  });

  it('rejects a unit price of 0', async () => {
    await expectRule(
      insertRow(db, 'deals', {
        ...(await dealRow()),
        unit_price_minor: 0,
        total_minor: 0,
      }),
      'deals_unit_price_positive',
    );
  });

  it('rejects a total that is not quantity times unit price', async () => {
    await expectRule(
      insertRow(db, 'deals', { ...(await dealRow()), total_minor: 299_999 }),
      'deals_total_matches',
    );
  });

  it('rejects an unknown status', async () => {
    await expectRule(
      insertRow(db, 'deals', { ...(await dealRow()), status: 'lost' }),
      'deals_status_check',
    );
  });

  it.each(['shipped', 'disputed', 'completed'])(
    'rejects a %s deal without a confirmation deadline, and accepts one with it',
    async (status) => {
      const row = { ...(await dealRow()), status };
      await expectRule(
        insertRow(db, 'deals', row),
        'deals_shipped_has_deadline',
      );
      await expect(
        insertRow(db, 'deals', {
          ...row,
          confirmation_due_at: new Date(Date.now() + 14 * DAY_MS),
        }),
      ).resolves.toMatchObject({ status });
    },
  );

  it('rejects a second deal with the same idempotency key from one buyer', async () => {
    const row = await dealRow();
    await insertRow(db, 'deals', row);
    await expectRule(
      insertRow(db, 'deals', row),
      'deals_buyer_idempotency_key_key',
    );
  });

  it('accepts the same idempotency key from two different buyers', async () => {
    const key = randomUUID();
    await insertRow(db, 'deals', {
      ...(await dealRow()),
      idempotency_key: key,
    });
    await expect(
      insertRow(db, 'deals', { ...(await dealRow()), idempotency_key: key }),
    ).resolves.toMatchObject({ idempotency_key: key });
  });

  it('requires every column except the confirmation deadline', async () => {
    await expectRequiredColumns(db, 'deals', dealRow, [
      'lot_id',
      'buyer_company_id',
      'seller_company_id',
      'quantity',
      'unit_price_minor',
      'total_minor',
      'status',
      'idempotency_key',
      'created_at',
      'updated_at',
    ]);
  });
});

describe('deal_status_changes', () => {
  const firstRow = async () => {
    const { dealId } = await createDealSetup(db);
    return {
      deal_id: dealId,
      from_status: null,
      to_status: 'awaiting_payment',
      actor_type: 'buyer',
      actor_ref: 'buyer-1',
    };
  };
  const refundRow = async () => ({
    ...(await firstRow()),
    from_status: 'paid',
    to_status: 'refunded',
    actor_type: 'operator',
    actor_ref: 'operator-1',
    reason: 'Seller cannot ship',
  });

  it('stores the first status change of a deal', async () => {
    await expect(
      insertRow(db, 'deal_status_changes', await firstRow()),
    ).resolves.toMatchObject({ to_status: 'awaiting_payment' });
  });

  it('allows only one row without a previous status per deal', async () => {
    const row = await firstRow();
    await insertRow(db, 'deal_status_changes', row);
    await expectRule(
      insertRow(db, 'deal_status_changes', row),
      'deal_status_changes_creation_key',
    );
  });

  it('belongs only to an existing deal', async () => {
    await expectRule(
      insertRow(db, 'deal_status_changes', {
        ...(await firstRow()),
        deal_id: randomUUID(),
      }),
      'deal_status_changes_deal_id_fkey',
    );
  });

  it('rejects an unknown previous status', async () => {
    await expectRule(
      insertRow(db, 'deal_status_changes', {
        ...(await refundRow()),
        from_status: 'lost',
      }),
      'deal_status_changes_from_status_check',
    );
  });

  it('rejects an unknown new status', async () => {
    await expectRule(
      insertRow(db, 'deal_status_changes', {
        ...(await firstRow()),
        to_status: 'lost',
      }),
      'deal_status_changes_to_status_check',
    );
  });

  it('rejects an unknown actor type', async () => {
    await expectRule(
      insertRow(db, 'deal_status_changes', {
        ...(await firstRow()),
        actor_type: 'robot',
      }),
      'deal_status_changes_actor_type_check',
    );
  });

  it.each([
    ['system', 'job-1'],
    ['buyer', null],
  ])('rejects actor %s with reference %j', async (actor_type, actor_ref) => {
    await expectRule(
      insertRow(db, 'deal_status_changes', {
        ...(await firstRow()),
        actor_type,
        actor_ref,
      }),
      'deal_status_changes_actor_ref_matches_type',
    );
  });

  it('accepts a system change without a reference (automatic expiry)', async () => {
    await expect(
      insertRow(db, 'deal_status_changes', {
        ...(await firstRow()),
        actor_type: 'system',
        actor_ref: null,
      }),
    ).resolves.toMatchObject({ actor_type: 'system' });
  });

  it.each([null, '   '])(
    'rejects a refund with the reason %j',
    async (reason) => {
      await expectRule(
        insertRow(db, 'deal_status_changes', {
          ...(await refundRow()),
          reason,
        }),
        'deal_status_changes_reason_required',
      );
    },
  );

  it('accepts a refund with a reason', async () => {
    await expect(
      insertRow(db, 'deal_status_changes', await refundRow()),
    ).resolves.toMatchObject({ reason: 'Seller cannot ship' });
  });

  it('never changes or deletes a status change (Story 2 scenario 6)', async () => {
    const row = await insertRow(db, 'deal_status_changes', await firstRow());
    await expectRule(
      db.query(
        "UPDATE deal_status_changes SET to_status = 'paid' WHERE id = $1",
        [row.id],
      ),
      'deal_status_changes_append_only',
    );
    await expectRule(
      db.query('DELETE FROM deal_status_changes WHERE id = $1', [row.id]),
      'deal_status_changes_append_only',
    );
  });

  it('requires the deal, the new status, the actor type and the time', async () => {
    await expectRequiredColumns(db, 'deal_status_changes', firstRow, [
      'deal_id',
      'to_status',
      'actor_type',
      'changed_at',
    ]);
  });
});

describe('invoices', () => {
  const invoiceRow = async () => {
    const { dealId } = await createDealSetup(db);
    const issuedAt = new Date();
    return {
      deal_id: dealId,
      amount_minor: 100_000,
      status: 'issued',
      issued_at: issuedAt,
      due_at: new Date(issuedAt.getTime() + 5 * DAY_MS),
      expires_at: new Date(issuedAt.getTime() + 6 * DAY_MS),
    };
  };

  it('stores a valid invoice with a generated number', async () => {
    const row = await insertRow(db, 'invoices', await invoiceRow());
    expect(row.number).toMatch(/^INV-\d{4}-\d{6,}$/);
  });

  it('rejects a second invoice for the same deal (Story 2 scenario 5)', async () => {
    const row = await invoiceRow();
    await insertRow(db, 'invoices', row);
    await expectRule(insertRow(db, 'invoices', row), 'invoices_deal_id_key');
  });

  it('belongs only to an existing deal', async () => {
    await expectRule(
      insertRow(db, 'invoices', {
        ...(await invoiceRow()),
        deal_id: randomUUID(),
      }),
      'invoices_deal_id_fkey',
    );
  });

  it('rejects a number that is already used', async () => {
    const first = await insertRow(db, 'invoices', await invoiceRow());
    await expectRule(
      insertRow(db, 'invoices', {
        ...(await invoiceRow()),
        number: first.number,
      }),
      'invoices_number_key',
    );
  });

  it.each(['INV-1', 'INV-2026-12345', 'inv-2026-123456'])(
    'rejects the number %j',
    async (number) => {
      await expectRule(
        insertRow(db, 'invoices', { ...(await invoiceRow()), number }),
        'invoices_number_format',
      );
    },
  );

  it('rejects an amount of 0', async () => {
    await expectRule(
      insertRow(db, 'invoices', { ...(await invoiceRow()), amount_minor: 0 }),
      'invoices_amount_positive',
    );
  });

  it('rejects an unknown status', async () => {
    await expectRule(
      insertRow(db, 'invoices', { ...(await invoiceRow()), status: 'void' }),
      'invoices_status_check',
    );
  });

  it('rejects a due date before the issue date, and an expiry before the due date', async () => {
    const row = await invoiceRow();
    await expectRule(
      insertRow(db, 'invoices', {
        ...row,
        due_at: new Date(row.issued_at.getTime() - DAY_MS),
      }),
      'invoices_dates_ordered',
    );
    await expectRule(
      insertRow(db, 'invoices', {
        ...(await invoiceRow()),
        expires_at: row.issued_at,
      }),
      'invoices_dates_ordered',
    );
  });

  it('sets the payment time exactly for a paid invoice', async () => {
    await expectRule(
      insertRow(db, 'invoices', { ...(await invoiceRow()), status: 'paid' }),
      'invoices_paid_at_matches_status',
    );
    await expectRule(
      insertRow(db, 'invoices', {
        ...(await invoiceRow()),
        paid_at: new Date(),
      }),
      'invoices_paid_at_matches_status',
    );
    const { dealId } = await createDealSetup(db);
    await expect(
      createInvoice(db, dealId, { status: 'paid', paidAt: new Date() }),
    ).resolves.toEqual(expect.any(String));
  });

  it('requires every column except the payment time', async () => {
    await expectRequiredColumns(db, 'invoices', invoiceRow, [
      'deal_id',
      'number',
      'amount_minor',
      'status',
      'issued_at',
      'due_at',
      'expires_at',
    ]);
  });
});
