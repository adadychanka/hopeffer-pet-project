// User Story 3: the seller, or an operator, changes the price of a lot
// (POST /lots/{lotId}/price-changes). Deals and invoices keep their price.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCompany,
  createDeal,
  createInvoice,
  createLot,
  type LotFixture,
  type TestCompany,
} from '../schema/helpers.js';
import {
  bootApp,
  type BootedApp,
  companyHeaders,
  expectProblem,
  operatorHeaders,
} from './helpers.js';

let booted: BootedApp;
let db: DataSource;

beforeAll(async () => {
  booted = await bootApp();
  db = booted.db;
});

afterAll(async () => {
  await booted.app.close();
});

interface PriceChangeBody {
  id: string;
  lotId: string;
  oldPriceMinor: number;
  newPriceMinor: number;
  actorType: string;
  changedAt: string;
}

function changePrice(
  lotId: string,
  body: unknown,
  headers: Record<string, string>,
) {
  return request(booted.app.getHttpServer())
    .post(`/lots/${lotId}/price-changes`)
    .set(headers)
    .send(body as object);
}

async function sellerWithLot(
  lot: LotFixture = {},
): Promise<{ seller: TestCompany; lotId: string }> {
  const seller = await createCompany(db);
  return { seller, lotId: await createLot(db, seller.id, lot) };
}

async function lotOf(lotId: string) {
  const rows = await db.query<{ unit_price_minor: string; status: string }[]>(
    'SELECT unit_price_minor, status FROM lots WHERE id = $1',
    [lotId],
  );
  return rows[0];
}

async function historyOf(lotId: string) {
  return db.query<
    {
      old_price_minor: string | null;
      new_price_minor: string;
      actor_type: string;
      actor_ref: string;
    }[]
  >(
    `SELECT old_price_minor, new_price_minor, actor_type, actor_ref
     FROM lot_price_changes WHERE lot_id = $1 ORDER BY id`,
    [lotId],
  );
}

describe('POST /lots/{lotId}/price-changes: User Story 3', () => {
  it('lets the seller change the price and records the change', async () => {
    const { seller, lotId } = await sellerWithLot();

    const response = await changePrice(
      lotId,
      { unitPriceMinor: 120_000 },
      companyHeaders(seller.id, 'seller-person-1'),
    );

    expect(response.status).toBe(201);
    const body = response.body as PriceChangeBody;
    expect(body).toMatchObject({
      lotId,
      oldPriceMinor: 100_000,
      newPriceMinor: 120_000,
      actorType: 'seller',
    });
    expect(typeof body.id).toBe('string');
    expect(Date.parse(body.changedAt)).not.toBeNaN();
    expect((await lotOf(lotId)).unit_price_minor).toBe('120000');
    expect(await historyOf(lotId)).toEqual([
      {
        old_price_minor: '100000',
        new_price_minor: '120000',
        actor_type: 'seller',
        actor_ref: 'seller-person-1',
      },
    ]);
  });

  it('lets an operator change the price', async () => {
    const { lotId } = await sellerWithLot();

    const response = await changePrice(
      lotId,
      { unitPriceMinor: 90_000 },
      operatorHeaders('operator-7'),
    );

    expect(response.status).toBe(201);
    expect((response.body as PriceChangeBody).actorType).toBe('operator');
    expect((await historyOf(lotId))[0]).toMatchObject({
      actor_type: 'operator',
      actor_ref: 'operator-7',
    });
  });

  it('keeps the price of existing deals and invoices', async () => {
    const { seller, lotId } = await sellerWithLot();
    const buyer = await createCompany(db);
    const dealId = await createDeal(db, {
      buyerId: buyer.id,
      sellerId: seller.id,
      lotId,
      quantity: 3,
    });
    await createInvoice(db, dealId, { amountMinor: 300_000 });

    await changePrice(
      lotId,
      { unitPriceMinor: 120_000 },
      companyHeaders(seller.id),
    );

    const rows = await db.query<
      { unit_price_minor: string; total_minor: string; amount_minor: string }[]
    >(
      `SELECT d.unit_price_minor, d.total_minor, i.amount_minor
       FROM deals d JOIN invoices i ON i.deal_id = d.id WHERE d.id = $1`,
      [dealId],
    );
    expect(rows[0]).toEqual({
      unit_price_minor: '100000',
      total_minor: '300000',
      amount_minor: '300000',
    });
  });

  it('rejects the current price', async () => {
    const { seller, lotId } = await sellerWithLot();

    expectProblem(
      await changePrice(
        lotId,
        { unitPriceMinor: 100_000 },
        companyHeaders(seller.id),
      ),
      409,
      'price_unchanged',
    );
    expect(await historyOf(lotId)).toEqual([]);
  });

  it('rejects another company: not the seller on a published lot, not found on a hidden one', async () => {
    const published = await sellerWithLot();
    const hidden = await sellerWithLot({ status: 'hidden' });
    const other = await createCompany(db);

    expectProblem(
      await changePrice(
        published.lotId,
        { unitPriceMinor: 1 },
        companyHeaders(other.id),
      ),
      403,
      'not_lot_seller',
    );
    expectProblem(
      await changePrice(
        hidden.lotId,
        { unitPriceMinor: 1 },
        companyHeaders(other.id),
      ),
      404,
      'lot_not_found',
    );
    expect((await lotOf(published.lotId)).unit_price_minor).toBe('100000');
    expect((await lotOf(hidden.lotId)).unit_price_minor).toBe('100000');
  });

  it.each([0, -1, 1.5, '120000', Number.MAX_SAFE_INTEGER + 2])(
    'rejects the price %j',
    async (unitPriceMinor) => {
      const { seller, lotId } = await sellerWithLot();

      expectProblem(
        await changePrice(lotId, { unitPriceMinor }, companyHeaders(seller.id)),
        400,
        'validation_failed',
      );
      expect(await historyOf(lotId)).toEqual([]);
    },
  );
});

describe('POST /lots/{lotId}/price-changes: edge cases', () => {
  it('answers an unknown lot with 404 and a malformed id with 400', async () => {
    expectProblem(
      await changePrice(randomUUID(), { unitPriceMinor: 1 }, operatorHeaders()),
      404,
      'lot_not_found',
    );
    const malformed = await changePrice(
      'not-a-uuid',
      { unitPriceMinor: 1 },
      operatorHeaders(),
    );
    expectProblem(malformed, 400, 'validation_failed');
    expect(
      (malformed.body as { errors: { path: string }[] }).errors[0].path,
    ).toBe('path');
  });

  it('lets the seller reprice a hidden lot, which stays hidden', async () => {
    const { seller, lotId } = await sellerWithLot({ status: 'hidden' });

    const response = await changePrice(
      lotId,
      { unitPriceMinor: 80_000 },
      companyHeaders(seller.id),
    );

    expect(response.status).toBe(201);
    expect(await lotOf(lotId)).toEqual({
      unit_price_minor: '80000',
      status: 'hidden',
    });
  });

  it('applies two parallel changes one after the other (SC-007)', async () => {
    const { seller, lotId } = await sellerWithLot();

    const responses = await Promise.all([
      changePrice(
        lotId,
        { unitPriceMinor: 110_000 },
        companyHeaders(seller.id),
      ),
      changePrice(
        lotId,
        { unitPriceMinor: 120_000 },
        companyHeaders(seller.id),
      ),
    ]);

    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const history = await historyOf(lotId);
    expect(history).toHaveLength(2);
    expect(history[0].old_price_minor).toBe('100000');
    expect(history[1].old_price_minor).toBe(history[0].new_price_minor);
    expect((await lotOf(lotId)).unit_price_minor).toBe(
      history[1].new_price_minor,
    );
  });
});
