// User Story 1: a buyer buys units of a lot (POST /deals). Pay later reserves
// the stock and issues an invoice; pay at once also pays the invoice from the
// wallet into escrow in the same step.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createDeal,
  createInvoice,
  createLot,
  DAY_MS,
  ledgerEntriesOf,
  platformAccountId,
  type LotFixture,
  type TestCompany,
  walletBalance,
} from '../schema/helpers.js';
import {
  bootApp,
  type BootedApp,
  companyHeaders,
  expectProblem,
  expectWalletConsistent,
  fundWallet,
  operatorHeaders,
  readSettings,
  type Settings,
} from './helpers.js';

let booted: BootedApp;
let db: DataSource;
let settings: Settings;
let escrowId: string;

beforeAll(async () => {
  booted = await bootApp();
  db = booted.db;
  settings = await readSettings(db);
  escrowId = await platformAccountId(db, 'escrow');
});

afterAll(async () => {
  await booted.app.close();
});

interface DealBody {
  deal: {
    id: string;
    lotId: string;
    buyerCompanyId: string;
    sellerCompanyId: string;
    quantity: number;
    unitPriceMinor: number;
    totalMinor: number;
    status: string;
    createdAt: string;
  };
  invoice: {
    id: string;
    number: string;
    amountMinor: number;
    status: string;
    issuedAt: string;
    dueAt: string;
    expiresAt: string;
    paidAt: string | null;
  };
}

function buy(
  buyerId: string,
  body: unknown,
  idempotencyKey: string = randomUUID(),
) {
  return request(booted.app.getHttpServer())
    .post('/deals')
    .set(companyHeaders(buyerId))
    .set('Idempotency-Key', idempotencyKey)
    .send(body as object);
}

interface Market {
  seller: TestCompany;
  buyer: TestCompany;
  lotId: string;
}

// A seller with a published lot (price 1,000.00, stock 5 by default) and a
// buyer with a wallet at 0.
async function market(lot: LotFixture = {}): Promise<Market> {
  const seller = await createCompany(db);
  const buyer = await createCompany(db);
  const lotId = await createLot(db, seller.id, lot);
  return { seller, buyer, lotId };
}

async function stockOf(lotId: string): Promise<number> {
  const rows = await db.query<{ stock_available: number }[]>(
    'SELECT stock_available FROM lots WHERE id = $1',
    [lotId],
  );
  return rows[0].stock_available;
}

async function dealCount(buyerId: string): Promise<number> {
  const rows = await db.query<{ n: number }[]>(
    'SELECT count(*)::int AS n FROM deals WHERE buyer_company_id = $1',
    [buyerId],
  );
  return rows[0].n;
}

async function paymentTransferOf(invoiceId: string): Promise<string[]> {
  const rows = await db.query<{ id: string }[]>(
    `SELECT id FROM ledger_transfers
     WHERE type = 'invoice_payment' AND invoice_id = $1`,
    [invoiceId],
  );
  return rows.map((row) => row.id);
}

// Unpaid deals of the buyer, made directly as data.
async function unpaidDeals(m: Market, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await createDeal(db, {
      buyerId: m.buyer.id,
      sellerId: m.seller.id,
      lotId: m.lotId,
    });
  }
}

// Expired deals of the buyer whose invoices expired daysAgo days ago.
async function expiredDeals(
  m: Market,
  count: number,
  daysAgo: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() - daysAgo * DAY_MS);
  for (let i = 0; i < count; i += 1) {
    const dealId = await createDeal(db, {
      buyerId: m.buyer.id,
      sellerId: m.seller.id,
      lotId: m.lotId,
      status: 'expired',
    });
    await createInvoice(db, dealId, {
      status: 'expired',
      issuedAt: new Date(expiresAt.getTime() - 6 * DAY_MS),
      dueAt: new Date(expiresAt.getTime() - DAY_MS),
      expiresAt,
    });
  }
}

describe('POST /deals: User Story 1', () => {
  it('reserves the stock and issues an invoice when paying later', async () => {
    const m = await market();

    const response = await buy(m.buyer.id, { lotId: m.lotId, quantity: 3 });

    expect(response.status).toBe(201);
    const { deal, invoice } = response.body as DealBody;
    expect(deal).toMatchObject({
      lotId: m.lotId,
      buyerCompanyId: m.buyer.id,
      sellerCompanyId: m.seller.id,
      quantity: 3,
      unitPriceMinor: 100_000,
      totalMinor: 300_000,
      status: 'awaiting_payment',
    });
    expect(invoice).toMatchObject({
      amountMinor: 300_000,
      status: 'issued',
      paidAt: null,
    });
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{6,}$/);
    const issuedAt = Date.parse(invoice.issuedAt);
    expect(Date.parse(invoice.dueAt) - issuedAt).toBe(
      settings.paymentWindowDays * DAY_MS,
    );
    expect(Date.parse(invoice.expiresAt) - Date.parse(invoice.dueAt)).toBe(
      settings.gracePeriodDays * DAY_MS,
    );
    expect(await stockOf(m.lotId)).toBe(2);
    expect(await paymentTransferOf(invoice.id)).toEqual([]);
    const history = await db.query<
      { from_status: string | null; to_status: string; actor_type: string }[]
    >(
      `SELECT from_status, to_status, actor_type FROM deal_status_changes
       WHERE deal_id = $1 ORDER BY id`,
      [deal.id],
    );
    expect(history).toEqual([
      { from_status: null, to_status: 'awaiting_payment', actor_type: 'buyer' },
    ]);
  });

  it('pays the invoice from the wallet into escrow when paying at once', async () => {
    const m = await market();
    await fundWallet(db, m.buyer, 500_000);

    const response = await buy(m.buyer.id, {
      lotId: m.lotId,
      quantity: 3,
      payNow: true,
    });

    expect(response.status).toBe(201);
    const { deal, invoice } = response.body as DealBody;
    expect(deal.status).toBe('paid');
    expect(invoice.status).toBe('paid');
    expect(invoice.paidAt).not.toBeNull();
    expect(await walletBalance(db, m.buyer.id)).toBe(200_000);
    const history = await db.query<
      { from_status: string | null; to_status: string; actor_type: string }[]
    >(
      `SELECT from_status, to_status, actor_type FROM deal_status_changes
       WHERE deal_id = $1 ORDER BY id`,
      [deal.id],
    );
    expect(history).toEqual([
      { from_status: null, to_status: 'awaiting_payment', actor_type: 'buyer' },
      {
        from_status: 'awaiting_payment',
        to_status: 'paid',
        actor_type: 'buyer',
      },
    ]);
    const transfers = await paymentTransferOf(invoice.id);
    expect(transfers).toHaveLength(1);
    const entries = await ledgerEntriesOf(db, transfers[0]);
    expect(
      entries.map(({ accountId, amountMinor }) => ({ accountId, amountMinor })),
    ).toEqual(
      expect.arrayContaining([
        { accountId: m.buyer.walletId, amountMinor: -300_000 },
        { accountId: escrowId, amountMinor: 300_000 },
      ]),
    );
    await expectWalletConsistent(db, [m.buyer.id]);
  });

  it('rejects a purchase paid at once that the wallet does not cover', async () => {
    const m = await market();
    await fundWallet(db, m.buyer, 200_000);

    const response = await buy(m.buyer.id, {
      lotId: m.lotId,
      quantity: 3,
      payNow: true,
    });

    expectProblem(response, 422, 'insufficient_balance');
    expect(await dealCount(m.buyer.id)).toBe(0);
    expect(await stockOf(m.lotId)).toBe(5);
    expect(await walletBalance(db, m.buyer.id)).toBe(200_000);
    await expectWalletConsistent(db, [m.buyer.id]);
  });

  it('rejects more units than the stock', async () => {
    const m = await market({ stockAvailable: 2 });

    const response = await buy(m.buyer.id, { lotId: m.lotId, quantity: 3 });

    expectProblem(response, 422, 'insufficient_stock');
    expect(await dealCount(m.buyer.id)).toBe(0);
    expect(await stockOf(m.lotId)).toBe(2);
  });

  it('answers a repeated purchase with the same key as a replay', async () => {
    const m = await market();
    const key = randomUUID();

    const first = await buy(m.buyer.id, { lotId: m.lotId, quantity: 3 }, key);
    const second = await buy(m.buyer.id, { lotId: m.lotId, quantity: 3 }, key);

    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect((second.body as DealBody).deal.id).toBe(
      (first.body as DealBody).deal.id,
    );
    expect(await dealCount(m.buyer.id)).toBe(1);
    expect(await stockOf(m.lotId)).toBe(2);
  });

  it('stops paying later at the unpaid deal limit, but allows paying at once', async () => {
    const m = await market({ stockAvailable: 10 });
    await unpaidDeals(m, settings.maxUnpaidDeals);
    await fundWallet(db, m.buyer, 100_000);

    expectProblem(
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 1 }),
      422,
      'unpaid_deal_limit_reached',
    );
    const paid = await buy(m.buyer.id, {
      lotId: m.lotId,
      quantity: 1,
      payNow: true,
    });
    expect(paid.status).toBe(201);
  });

  it('makes a buyer with recent expired deals prepay only', async () => {
    const m = await market({ stockAvailable: 10 });
    await expiredDeals(m, settings.expiryLimit, 10);
    await fundWallet(db, m.buyer, 100_000);

    expectProblem(
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 1 }),
      422,
      'prepay_only',
    );
    const paid = await buy(m.buyer.id, {
      lotId: m.lotId,
      quantity: 1,
      payNow: true,
    });
    expect(paid.status).toBe(201);
  });

  it('lets a buyer pay later again once the expired deals leave the look-back period', async () => {
    const m = await market();
    await expiredDeals(
      m,
      settings.expiryLimit,
      settings.expiryLookbackDays + 10,
    );

    const response = await buy(m.buyer.id, { lotId: m.lotId, quantity: 1 });

    expect(response.status).toBe(201);
  });
});

describe('POST /deals: edge cases and errors', () => {
  it('rejects buying your own lot', async () => {
    const m = await market();

    expectProblem(
      await buy(m.seller.id, { lotId: m.lotId, quantity: 1 }),
      422,
      'own_lot',
    );
    expect(await stockOf(m.lotId)).toBe(5);
  });

  it('answers a hidden lot and an unknown lot as not found', async () => {
    const m = await market({ status: 'hidden' });

    expectProblem(
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 1 }),
      404,
      'lot_not_found',
    );
    expectProblem(
      await buy(m.buyer.id, { lotId: randomUUID(), quantity: 1 }),
      404,
      'lot_not_found',
    );
    expect(await stockOf(m.lotId)).toBe(5);
  });

  it('rejects a sold-out lot', async () => {
    const m = await market({ stockAvailable: 0 });

    expectProblem(
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 1 }),
      422,
      'insufficient_stock',
    );
  });

  it.each([0, -1, 1.5, '2', 2_147_483_648])(
    'rejects the quantity %j',
    async (quantity) => {
      const m = await market();

      const response = await buy(m.buyer.id, { lotId: m.lotId, quantity });

      expectProblem(response, 400, 'validation_failed');
      expect((response.body as { errors: { path: string }[] }).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'body.quantity' }),
        ]),
      );
    },
  );

  it('rejects unknown body fields and a missing lot id', async () => {
    const m = await market();

    expectProblem(
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 1, price: 1 }),
      400,
      'validation_failed',
    );
    expectProblem(
      await buy(m.buyer.id, { quantity: 1 }),
      400,
      'validation_failed',
    );
  });

  it('rejects a total above the largest exact amount, without touching the stock', async () => {
    const m = await market({ unitPriceMinor: 2 ** 52 });

    expectProblem(
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 3 }),
      422,
      'amount_too_large',
    );
    expect(await stockOf(m.lotId)).toBe(5);
  });

  it('rejects a buyer without a wallet and an unknown buyer', async () => {
    const m = await market();
    const noWallet = await createCompany(db, { wallet: false });

    expectProblem(
      await buy(noWallet.id, { lotId: m.lotId, quantity: 1 }),
      422,
      'wallet_not_activated',
    );
    expectProblem(
      await buy(randomUUID(), { lotId: m.lotId, quantity: 1 }),
      422,
      'company_not_found',
    );
    expect(await stockOf(m.lotId)).toBe(5);
  });

  it('requires a uuid Idempotency-Key', async () => {
    const m = await market();
    const server = booted.app.getHttpServer();

    const missing = await request(server)
      .post('/deals')
      .set(companyHeaders(m.buyer.id))
      .send({ lotId: m.lotId, quantity: 1 });
    expectProblem(missing, 400, 'validation_failed');
    expect(
      (missing.body as { errors: { path: string }[] }).errors[0].path,
    ).toBe('headers.idempotency-key');
    expectProblem(
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 1 }, 'not-a-uuid'),
      400,
      'validation_failed',
    );
  });

  it('rejects an operator and missing actor headers', async () => {
    const m = await market();
    const server = booted.app.getHttpServer();

    expectProblem(
      await request(server)
        .post('/deals')
        .set(operatorHeaders())
        .set('Idempotency-Key', randomUUID())
        .send({ lotId: m.lotId, quantity: 1 }),
      403,
      'forbidden_role',
    );
    expectProblem(
      await request(server)
        .post('/deals')
        .set('Idempotency-Key', randomUUID())
        .send({ lotId: m.lotId, quantity: 1 }),
      400,
      'validation_failed',
    );
  });

  it('rejects a key reused for another quantity, and replays one reused with only another payNow', async () => {
    const m = await market();
    await fundWallet(db, m.buyer, 500_000);
    const key = randomUUID();
    await buy(m.buyer.id, { lotId: m.lotId, quantity: 1 }, key);

    expectProblem(
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 2 }, key),
      422,
      'idempotency_key_reused',
    );
    const replay = await buy(
      m.buyer.id,
      { lotId: m.lotId, quantity: 1, payNow: true },
      key,
    );
    expect(replay.status).toBe(200);
    expect((replay.body as DealBody).deal.status).toBe('awaiting_payment');
    expect(await walletBalance(db, m.buyer.id)).toBe(500_000);
    expect(await dealCount(m.buyer.id)).toBe(1);
  });

  it('answers malformed JSON as a validation problem', async () => {
    const m = await market();

    const response = await request(booted.app.getHttpServer())
      .post('/deals')
      .set(companyHeaders(m.buyer.id))
      .set('Idempotency-Key', randomUUID())
      .set('Content-Type', 'application/json')
      .send('{"lotId":');

    expectProblem(response, 400, 'validation_failed');
  });

  it('keeps the deal price when the lot price changes later', async () => {
    const m = await market();
    const { deal, invoice } = (
      await buy(m.buyer.id, { lotId: m.lotId, quantity: 3 })
    ).body as DealBody;

    await db.query(
      'UPDATE lots SET unit_price_minor = 120000, updated_at = now() WHERE id = $1',
      [m.lotId],
    );

    const rows = await db.query<
      { unit_price_minor: string; total_minor: string; amount_minor: string }[]
    >(
      `SELECT d.unit_price_minor, d.total_minor, i.amount_minor
       FROM deals d JOIN invoices i ON i.deal_id = d.id WHERE d.id = $1`,
      [deal.id],
    );
    expect(rows[0]).toEqual({
      unit_price_minor: '100000',
      total_minor: '300000',
      amount_minor: '300000',
    });
    expect(invoice.amountMinor).toBe(300_000);
  });
});

describe('POST /deals: at the same time', () => {
  it('sells the last unit to exactly one of 10 buyers (SC-001)', async () => {
    const seller = await createCompany(db);
    const lotId = await createLot(db, seller.id, { stockAvailable: 1 });
    const buyers = await Promise.all(
      Array.from({ length: 10 }, () => createCompany(db)),
    );

    const responses = await Promise.all(
      buyers.map((buyer) => buy(buyer.id, { lotId, quantity: 1 })),
    );

    const statuses = responses
      .map((response) => response.status)
      .sort((a, b) => a - b);
    expect(statuses).toEqual([201, ...Array<number>(9).fill(422)]);
    for (const response of responses.filter((r) => r.status === 422)) {
      expectProblem(response, 422, 'insufficient_stock');
    }
    expect(await stockOf(lotId)).toBe(0);
  });

  it('never spends more than the balance (SC-002)', async () => {
    const m = await market({ stockAvailable: 10 });
    await fundWallet(db, m.buyer, 500_000);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        buy(m.buyer.id, { lotId: m.lotId, quantity: 1, payNow: true }),
      ),
    );

    const created = responses.filter((response) => response.status === 201);
    expect(created).toHaveLength(5);
    for (const response of responses.filter((r) => r.status !== 201)) {
      expectProblem(response, 422, 'insufficient_balance');
    }
    expect(await walletBalance(db, m.buyer.id)).toBe(0);
    expect(await stockOf(m.lotId)).toBe(5);
    await expectWalletConsistent(db, [m.buyer.id]);
  });

  it('creates one deal for parallel requests with one key (SC-005)', async () => {
    const m = await market();
    const key = randomUUID();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        buy(m.buyer.id, { lotId: m.lotId, quantity: 1 }, key),
      ),
    );

    const ids = new Set(responses.map((r) => (r.body as DealBody).deal.id));
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await dealCount(m.buyer.id)).toBe(1);
    expect(await stockOf(m.lotId)).toBe(4);
  });
});
