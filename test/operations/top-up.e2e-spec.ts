// User Story 2: the operator records a bank notification (POST /top-ups).
// The money reaches the company's wallet; an issued invoice of the same
// company that the new balance covers is paid in the same step.
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
  type TestCompany,
  unique,
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
} from './helpers.js';

let booted: BootedApp;
let db: DataSource;
let bankClearingId: string;
let escrowId: string;

beforeAll(async () => {
  booted = await bootApp();
  db = booted.db;
  bankClearingId = await platformAccountId(db, 'bank_clearing');
  escrowId = await platformAccountId(db, 'escrow');
});

afterAll(async () => {
  await booted.app.close();
});

interface TopUpBody {
  topUp: {
    id: string;
    companyId: string;
    amountMinor: number;
    bankReference: string;
    transferDate: string;
    invoiceId: string | null;
    recordedAt: string;
  };
  walletBalanceMinor: number;
  paidInvoiceId: string | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function reference(): string {
  return unique('TRX').toUpperCase();
}

function topUp(body: Record<string, unknown>, headers = operatorHeaders()) {
  return request(booted.app.getHttpServer())
    .post('/top-ups')
    .set(headers)
    .send({ transferDate: today(), bankReference: reference(), ...body });
}

interface OpenInvoice {
  buyer: TestCompany;
  dealId: string;
  invoiceId: string;
}

// A deal in awaiting payment of 3 units at 1,000.00, with its issued invoice.
async function openInvoice({
  dealStatus = 'awaiting_payment',
  invoiceStatus = 'issued',
} = {}): Promise<OpenInvoice> {
  const seller = await createCompany(db);
  const buyer = await createCompany(db);
  const lotId = await createLot(db, seller.id);
  const dealId = await createDeal(db, {
    buyerId: buyer.id,
    sellerId: seller.id,
    lotId,
    quantity: 3,
    status: dealStatus,
  });
  const invoiceId = await createInvoice(db, dealId, {
    amountMinor: 300_000,
    status: invoiceStatus,
    paidAt: invoiceStatus === 'paid' ? new Date() : null,
  });
  return { buyer, dealId, invoiceId };
}

async function statusOf(open: OpenInvoice) {
  const rows = await db.query<{ deal: string; invoice: string }[]>(
    `SELECT d.status AS deal, i.status AS invoice
     FROM deals d JOIN invoices i ON i.deal_id = d.id WHERE d.id = $1`,
    [open.dealId],
  );
  return rows[0];
}

async function transfersOf(topUpId: string, invoiceId: string) {
  return db.query<{ id: string; type: string; actor_type: string }[]>(
    `SELECT id, type, actor_type FROM ledger_transfers
     WHERE top_up_id = $1 OR (type = 'invoice_payment' AND invoice_id = $2)
     ORDER BY created_at, type DESC`,
    [topUpId, invoiceId],
  );
}

async function topUpCount(companyId: string): Promise<number> {
  const rows = await db.query<{ n: number }[]>(
    'SELECT count(*)::int AS n FROM top_ups WHERE company_id = $1',
    [companyId],
  );
  return rows[0].n;
}

describe('POST /top-ups: User Story 2', () => {
  it('credits the wallet from bank clearing', async () => {
    const company = await createCompany(db);
    const bankReference = reference();

    const response = await topUp({
      companyId: company.id,
      amountMinor: 300_000,
      bankReference,
    });

    expect(response.status).toBe(201);
    const body = response.body as TopUpBody;
    expect(body).toMatchObject({
      topUp: {
        companyId: company.id,
        amountMinor: 300_000,
        bankReference,
        transferDate: today(),
        invoiceId: null,
      },
      walletBalanceMinor: 300_000,
      paidInvoiceId: null,
    });
    expect(await walletBalance(db, company.id)).toBe(300_000);
    const transfers = await db.query<
      { id: string; type: string; actor_type: string; actor_ref: string }[]
    >(
      'SELECT id, type, actor_type, actor_ref FROM ledger_transfers WHERE top_up_id = $1',
      [body.topUp.id],
    );
    expect(transfers).toEqual([
      expect.objectContaining({
        type: 'top_up',
        actor_type: 'operator',
        actor_ref: 'operator-1',
      }),
    ]);
    const entries = await ledgerEntriesOf(db, transfers[0].id);
    expect(
      entries.map(({ accountId, amountMinor }) => ({ accountId, amountMinor })),
    ).toEqual(
      expect.arrayContaining([
        { accountId: bankClearingId, amountMinor: -300_000 },
        { accountId: company.walletId, amountMinor: 300_000 },
      ]),
    );
    await expectWalletConsistent(db, [company.id]);
  });

  it('rejects a bank reference that is already recorded, in any case or spacing', async () => {
    const company = await createCompany(db);
    const bankReference = reference();
    await topUp({ companyId: company.id, amountMinor: 1_000, bankReference });

    const response = await topUp({
      companyId: company.id,
      amountMinor: 1_000,
      bankReference: ` ${bankReference.toLowerCase().replace('-', ' -')} `,
    });

    expectProblem(response, 409, 'bank_reference_already_recorded');
    expect(await walletBalance(db, company.id)).toBe(1_000);
    expect(await topUpCount(company.id)).toBe(1);
  });

  it('rejects a company without a wallet', async () => {
    const company = await createCompany(db, { wallet: false });

    expectProblem(
      await topUp({ companyId: company.id, amountMinor: 1_000 }),
      422,
      'wallet_not_activated',
    );
    expect(await topUpCount(company.id)).toBe(0);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2])(
    'rejects the amount %j',
    async (amountMinor) => {
      const company = await createCompany(db);

      const response = await topUp({ companyId: company.id, amountMinor });

      expectProblem(response, 400, 'validation_failed');
      expect(await topUpCount(company.id)).toBe(0);
    },
  );

  it('pays the named invoice when the new balance covers it', async () => {
    const open = await openInvoice();

    const response = await topUp({
      companyId: open.buyer.id,
      amountMinor: 300_000,
      invoiceId: open.invoiceId,
    });

    expect(response.status).toBe(201);
    const body = response.body as TopUpBody;
    expect(body.walletBalanceMinor).toBe(0);
    expect(body.paidInvoiceId).toBe(open.invoiceId);
    expect(body.topUp.invoiceId).toBe(open.invoiceId);
    expect(await statusOf(open)).toEqual({ deal: 'paid', invoice: 'paid' });
    const transfers = await transfersOf(body.topUp.id, open.invoiceId);
    expect(transfers.map(({ type, actor_type }) => [type, actor_type])).toEqual(
      [
        ['top_up', 'operator'],
        ['invoice_payment', 'operator'],
      ],
    );
    const payment = await ledgerEntriesOf(db, transfers[1].id);
    expect(
      payment.map(({ accountId, amountMinor }) => ({ accountId, amountMinor })),
    ).toEqual(
      expect.arrayContaining([
        { accountId: open.buyer.walletId, amountMinor: -300_000 },
        { accountId: escrowId, amountMinor: 300_000 },
      ]),
    );
    const history = await db.query<{ to_status: string; actor_type: string }[]>(
      'SELECT to_status, actor_type FROM deal_status_changes WHERE deal_id = $1',
      [open.dealId],
    );
    expect(history).toEqual([{ to_status: 'paid', actor_type: 'operator' }]);
    expect(await walletBalance(db, open.buyer.id)).toBe(0);
    await expectWalletConsistent(db, [open.buyer.id]);
  });

  it('leaves the invoice unpaid when the balance does not cover it', async () => {
    const open = await openInvoice();

    const response = await topUp({
      companyId: open.buyer.id,
      amountMinor: 200_000,
      invoiceId: open.invoiceId,
    });

    expect(response.status).toBe(201);
    expect((response.body as TopUpBody).paidInvoiceId).toBeNull();
    expect(await statusOf(open)).toEqual({
      deal: 'awaiting_payment',
      invoice: 'issued',
    });
    expect(await walletBalance(db, open.buyer.id)).toBe(200_000);
  });

  it('pays when the top-up and the money already in the wallet cover it together', async () => {
    const open = await openInvoice();
    await fundWallet(db, open.buyer, 100_000);

    const response = await topUp({
      companyId: open.buyer.id,
      amountMinor: 200_000,
      invoiceId: open.invoiceId,
    });

    expect((response.body as TopUpBody).paidInvoiceId).toBe(open.invoiceId);
    expect(await walletBalance(db, open.buyer.id)).toBe(0);
    await expectWalletConsistent(db, [open.buyer.id]);
  });

  it('stores but does not pay an invoice of another company or one already paid', async () => {
    const other = await openInvoice();
    const paid = await openInvoice({
      dealStatus: 'paid',
      invoiceStatus: 'paid',
    });
    const company = await createCompany(db);

    const foreign = await topUp({
      companyId: company.id,
      amountMinor: 300_000,
      invoiceId: other.invoiceId,
    });
    const again = await topUp({
      companyId: paid.buyer.id,
      amountMinor: 300_000,
      invoiceId: paid.invoiceId,
    });

    expect(foreign.status).toBe(201);
    expect((foreign.body as TopUpBody).topUp.invoiceId).toBe(other.invoiceId);
    expect((foreign.body as TopUpBody).paidInvoiceId).toBeNull();
    expect(await statusOf(other)).toEqual({
      deal: 'awaiting_payment',
      invoice: 'issued',
    });
    expect((again.body as TopUpBody).paidInvoiceId).toBeNull();
    expect(await walletBalance(db, company.id)).toBe(300_000);
    expect(await walletBalance(db, paid.buyer.id)).toBe(300_000);
  });
});

describe('POST /top-ups: edge cases and errors', () => {
  it('rejects an unknown invoice and an unknown company', async () => {
    const company = await createCompany(db);

    expectProblem(
      await topUp({
        companyId: company.id,
        amountMinor: 1_000,
        invoiceId: randomUUID(),
      }),
      422,
      'invoice_not_found',
    );
    expectProblem(
      await topUp({ companyId: randomUUID(), amountMinor: 1_000 }),
      422,
      'company_not_found',
    );
    expect(await topUpCount(company.id)).toBe(0);
  });

  it.each(['TRX_1', 'TRX#1', '', '   ', 'A'.repeat(141)])(
    'rejects the bank reference %j',
    async (bankReference) => {
      const company = await createCompany(db);

      const response = await topUp({
        companyId: company.id,
        amountMinor: 1_000,
        bankReference,
      });

      expectProblem(response, 400, 'validation_failed');
    },
  );

  it('accepts a 140 character reference after whitespace is removed', async () => {
    const company = await createCompany(db);
    const bankReference = `${randomUUID().replaceAll('-', '')}${'A'.repeat(108)}`;

    const response = await topUp({
      companyId: company.id,
      amountMinor: 1_000,
      bankReference: ` ${bankReference.slice(0, 70)} ${bankReference.slice(70)} `,
    });

    expect(response.status).toBe(201);
    expect((response.body as TopUpBody).topUp.bankReference).toBe(
      bankReference.toUpperCase(),
    );
  });

  it.each(['2026-02-30', '2026-13-01', '01.03.2026', 'today'])(
    'rejects the transfer date %j',
    async (transferDate) => {
      const company = await createCompany(db);

      expectProblem(
        await topUp({
          companyId: company.id,
          amountMinor: 1_000,
          transferDate,
        }),
        400,
        'validation_failed',
      );
    },
  );

  it('rejects a transfer date more than 1 day ahead, and accepts tomorrow', async () => {
    const company = await createCompany(db);
    const inDays = (days: number) =>
      new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

    expectProblem(
      await topUp({
        companyId: company.id,
        amountMinor: 1_000,
        transferDate: inDays(2),
      }),
      400,
      'validation_failed',
    );
    const tomorrow = await topUp({
      companyId: company.id,
      amountMinor: 1_000,
      transferDate: inDays(1),
    });
    expect(tomorrow.status).toBe(201);
  });

  it('rejects a company actor', async () => {
    const company = await createCompany(db);

    expectProblem(
      await topUp(
        { companyId: company.id, amountMinor: 1_000 },
        companyHeaders(company.id),
      ),
      403,
      'forbidden_role',
    );
  });

  it('keeps the money in the wallet when the invoice already expired', async () => {
    const open = await openInvoice({
      dealStatus: 'expired',
      invoiceStatus: 'expired',
    });

    const response = await topUp({
      companyId: open.buyer.id,
      amountMinor: 300_000,
      invoiceId: open.invoiceId,
    });

    expect((response.body as TopUpBody).paidInvoiceId).toBeNull();
    expect(await statusOf(open)).toEqual({
      deal: 'expired',
      invoice: 'expired',
    });
    expect(await walletBalance(db, open.buyer.id)).toBe(300_000);
  });

  it('keeps the rest in the wallet when the top-up is larger than the invoice', async () => {
    const open = await openInvoice();

    const response = await topUp({
      companyId: open.buyer.id,
      amountMinor: 450_000,
      invoiceId: open.invoiceId,
    });

    expect((response.body as TopUpBody).walletBalanceMinor).toBe(150_000);
    expect(await statusOf(open)).toEqual({ deal: 'paid', invoice: 'paid' });
    await expectWalletConsistent(db, [open.buyer.id]);
  });

  it('records one of two parallel top-ups with one reference (SC-004)', async () => {
    const company = await createCompany(db);
    const bankReference = reference();

    const responses = await Promise.all([
      topUp({ companyId: company.id, amountMinor: 1_000, bankReference }),
      topUp({ companyId: company.id, amountMinor: 1_000, bankReference }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expectProblem(
      responses.find((r) => r.status === 409) as (typeof responses)[number],
      409,
      'bank_reference_already_recorded',
    );
    expect(await walletBalance(db, company.id)).toBe(1_000);
    await expectWalletConsistent(db, [company.id]);
  });

  it('pays an invoice once when two top-ups name it at the same time (SC-009)', async () => {
    const open = await openInvoice();

    const responses = await Promise.all([
      topUp({
        companyId: open.buyer.id,
        amountMinor: 300_000,
        invoiceId: open.invoiceId,
      }),
      topUp({
        companyId: open.buyer.id,
        amountMinor: 300_000,
        invoiceId: open.invoiceId,
      }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const paidIds = responses.map((r) => (r.body as TopUpBody).paidInvoiceId);
    expect(paidIds.filter((id) => id === open.invoiceId)).toHaveLength(1);
    const payments = await db.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ledger_transfers
       WHERE type = 'invoice_payment' AND invoice_id = $1`,
      [open.invoiceId],
    );
    expect(payments[0].n).toBe(1);
    expect(await walletBalance(db, open.buyer.id)).toBe(300_000);
    await expectWalletConsistent(db, [open.buyer.id]);
  });
});
