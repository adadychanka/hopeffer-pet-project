// Story 4: later features read and write every table through the entities,
// and money amounts come back exactly, or the read fails loudly.
import { randomUUID } from 'node:crypto';
import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LotPhoto } from '../../src/catalog/lot-photo.entity.js';
import { LotPriceChange } from '../../src/catalog/lot-price-change.entity.js';
import { Lot } from '../../src/catalog/lot.entity.js';
import { Company } from '../../src/companies/company.entity.js';
import { DealStatusChange } from '../../src/deals/deal-status-change.entity.js';
import { Deal } from '../../src/deals/deal.entity.js';
import { Invoice } from '../../src/deals/invoice.entity.js';
import { Account } from '../../src/ledger/account.entity.js';
import { Correction } from '../../src/ledger/correction.entity.js';
import { LedgerEntry } from '../../src/ledger/ledger-entry.entity.js';
import { LedgerTransfer } from '../../src/ledger/ledger-transfer.entity.js';
import { TopUp } from '../../src/ledger/top-up.entity.js';
import { PlatformSettings } from '../../src/platform-settings/platform-settings.entity.js';
import {
  openTestDataSource,
  platformAccountId,
  rolledBackManager,
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

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

// Saves the row, reads it back by id and checks that every field survived.
async function roundTrip<T extends ObjectLiteral & { id: string | number }>(
  repository: Repository<T>,
  values: Partial<T>,
): Promise<T> {
  const saved = await repository.save(repository.create(values as T));
  const found = await repository.findOneByOrFail({ id: saved.id } as never);
  expect(found).toEqual(saved);
  expect(found).toMatchObject(values);
  return found;
}

async function companyWithWallet(): Promise<{
  company: Company;
  wallet: Account;
}> {
  const company = await roundTrip(db.getRepository(Company), {
    name: 'Acme Machinery',
    registrationNumber: unique('REG'),
    email: `${unique('sales')}@acme.test`,
  });
  const wallet = await roundTrip(db.getRepository(Account), {
    type: 'company_wallet',
    companyId: company.id,
    balanceMinor: 0,
  });
  return { company, wallet };
}

async function publishedLot(sellerCompanyId: string, unitPriceMinor = 100_000) {
  return roundTrip(db.getRepository(Lot), {
    sellerCompanyId,
    title: 'Excavator CAT 320',
    unitPriceMinor,
    stockAvailable: 5,
    status: 'published',
  });
}

describe('entities round-trip every table (Story 4 scenario 1)', () => {
  it('companies and accounts', async () => {
    const { wallet } = await companyWithWallet();
    expect(wallet.balanceMinor).toBe(0);
  });

  it('lots, lot photos and lot price changes', async () => {
    const { company } = await companyWithWallet();
    const lot = await publishedLot(company.id);
    await roundTrip(db.getRepository(LotPhoto), {
      lotId: lot.id,
      storageKey: unique('lots/photo'),
      originalFilename: 'front.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 204_800,
      widthPx: 1600,
      heightPx: 1200,
      position: 0,
    });
    await roundTrip(db.getRepository(LotPriceChange), {
      lotId: lot.id,
      oldPriceMinor: null,
      newPriceMinor: 100_000,
      actorType: 'seller',
      actorRef: 'seller-1',
    });
    await roundTrip(db.getRepository(LotPriceChange), {
      lotId: lot.id,
      oldPriceMinor: 100_000,
      newPriceMinor: 120_000,
      actorType: 'operator',
      actorRef: 'operator-1',
    });
  });

  it('deals, deal status changes and invoices', async () => {
    const buyer = await companyWithWallet();
    const seller = await companyWithWallet();
    const lot = await publishedLot(seller.company.id);
    const deal = await roundTrip(db.getRepository(Deal), {
      lotId: lot.id,
      buyerCompanyId: buyer.company.id,
      sellerCompanyId: seller.company.id,
      quantity: 3,
      unitPriceMinor: 100_000,
      totalMinor: 300_000,
      status: 'shipped',
      confirmationDueAt: new Date(Date.now() + 14 * DAY_MS),
      idempotencyKey: randomUUID(),
    });
    await roundTrip(db.getRepository(DealStatusChange), {
      dealId: deal.id,
      fromStatus: null,
      toStatus: 'awaiting_payment',
      actorType: 'buyer',
      actorRef: 'buyer-1',
      reason: null,
    });
    const issuedAt = new Date();
    const invoice = await roundTrip(db.getRepository(Invoice), {
      dealId: deal.id,
      amountMinor: 300_000,
      status: 'paid',
      issuedAt,
      dueAt: new Date(issuedAt.getTime() + 5 * DAY_MS),
      expiresAt: new Date(issuedAt.getTime() + 6 * DAY_MS),
      paidAt: new Date(issuedAt.getTime() + DAY_MS),
    });
    expect(invoice.number).toMatch(/^INV-\d{4}-\d{6,}$/);
  });

  it('top-ups, corrections, ledger transfers and ledger entries', async () => {
    const { company, wallet } = await companyWithWallet();
    const bankClearingId = await platformAccountId(db, 'bank_clearing');
    const topUp = await roundTrip(db.getRepository(TopUp), {
      companyId: company.id,
      amountMinor: 300_000,
      bankReference: unique('TRX').toUpperCase(),
      transferDate: '2026-03-01',
      invoiceId: null,
      operatorRef: 'operator-1',
    });
    await roundTrip(db.getRepository(Correction), {
      companyId: company.id,
      amountMinor: -2_500,
      reason: 'Wrong amount recorded',
      topUpId: topUp.id,
      operatorRef: 'operator-1',
      idempotencyKey: randomUUID(),
    });

    const { transfer, entries } = await db.transaction(async (manager) => {
      const transfer = await manager.save(
        manager.create(LedgerTransfer, {
          type: 'top_up',
          topUpId: topUp.id,
          invoiceId: null,
          dealId: null,
          correctionId: null,
          actorType: 'operator',
          actorRef: 'operator-1',
        }),
      );
      const entries = await manager.save(
        [
          { accountId: bankClearingId, amountMinor: -300_000 },
          { accountId: wallet.id, amountMinor: 300_000 },
        ].map((entry) =>
          manager.create(LedgerEntry, {
            transferId: transfer.id,
            balanceAfterMinor: entry.amountMinor,
            ...entry,
          }),
        ),
      );
      return { transfer, entries };
    });

    await expect(
      db.getRepository(LedgerTransfer).findOneByOrFail({ id: transfer.id }),
    ).resolves.toEqual(transfer);
    const stored = await db
      .getRepository(LedgerEntry)
      .find({ where: { transferId: transfer.id }, order: { id: 'ASC' } });
    expect(stored).toEqual(entries);
    expect(stored.map((entry) => entry.amountMinor)).toEqual([
      -300_000, 300_000,
    ]);
  });

  it('platform settings', async () => {
    // The settings row is shared, so the change is rolled back.
    const { saved, found } = await rolledBackManager(db, async (manager) => {
      const repository = manager.getRepository(PlatformSettings);
      const settings = await repository.findOneByOrFail({ id: 1 });
      settings.paymentWindowDays = 7;
      settings.updatedByRef = 'operator-1';
      const saved = await repository.save(settings);
      return { saved, found: await repository.findOneByOrFail({ id: 1 }) };
    });
    expect(found).toEqual(saved);
    expect(found).toMatchObject({
      paymentWindowDays: 7,
      updatedByRef: 'operator-1',
    });
  });
});

describe('money amounts (Story 4 scenarios 2 and 3, SC-005)', () => {
  it('round-trip the smallest and the largest supported amount exactly', async () => {
    const { company } = await companyWithWallet();
    for (const amount of [1, Number.MAX_SAFE_INTEGER]) {
      const lot = await publishedLot(company.id, amount);
      expect(lot.unitPriceMinor).toBe(amount);
    }
  });

  it('round-trip 1,000 random amounts exactly', async () => {
    const { company } = await companyWithWallet();
    const amounts = Array.from(
      { length: 1000 },
      () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1,
    );
    const repository = db.getRepository(Lot);
    await repository.save(
      amounts.map((unitPriceMinor) =>
        repository.create({
          sellerCompanyId: company.id,
          title: 'Spare part',
          unitPriceMinor,
          stockAvailable: 1,
        }),
      ),
      { chunk: 200 },
    );
    const stored = await repository.findBy({ sellerCompanyId: company.id });
    const ascending = (a: number, b: number) => a - b;
    expect(stored.map((lot) => lot.unitPriceMinor).sort(ascending)).toEqual(
      [...amounts].sort(ascending),
    );
  });

  it('fail loudly when a stored amount is above the supported range', async () => {
    const { company } = await companyWithWallet();
    const lot = await publishedLot(company.id);
    await db.query(
      'UPDATE lots SET unit_price_minor = 9007199254740992 WHERE id = $1',
      [lot.id],
    );
    await expect(
      db.getRepository(Lot).findOneBy({ id: lot.id }),
    ).rejects.toThrow(RangeError);
  });

  it('fail loudly when the code writes an amount above the supported range', async () => {
    const { company } = await companyWithWallet();
    await expect(
      publishedLot(company.id, Number.MAX_SAFE_INTEGER + 1),
    ).rejects.toThrow(RangeError);
  });
});

describe('updated_at (FR-022)', () => {
  it('changes on every save of a company, a lot and a deal', async () => {
    const buyer = await companyWithWallet();
    const seller = await companyWithWallet();
    const lot = await publishedLot(seller.company.id);
    const deal = await roundTrip(db.getRepository(Deal), {
      lotId: lot.id,
      buyerCompanyId: buyer.company.id,
      sellerCompanyId: seller.company.id,
      quantity: 1,
      unitPriceMinor: 100_000,
      totalMinor: 100_000,
      status: 'awaiting_payment',
      idempotencyKey: randomUUID(),
    });

    const cases: [Repository<ObjectLiteral>, ObjectLiteral, () => void][] = [
      [
        db.getRepository(Company),
        buyer.company,
        () => (buyer.company.name = 'Acme 2'),
      ],
      [db.getRepository(Lot), lot, () => (lot.title = 'Excavator, serviced')],
      [db.getRepository(Deal), deal, () => (deal.status = 'paid')],
    ];
    for (const [repository, entity, change] of cases) {
      const before = (entity.updatedAt as Date).getTime();
      await pause();
      change();
      const saved = await repository.save(entity);
      expect((saved.updatedAt as Date).getTime()).toBeGreaterThan(before);
    }
  });

  it('changes on a save of the platform settings', async () => {
    const { before, after } = await rolledBackManager(db, async (manager) => {
      const repository = manager.getRepository(PlatformSettings);
      const settings = await repository.findOneByOrFail({ id: 1 });
      const before = settings.updatedAt.getTime();
      settings.gracePeriodDays = 2;
      const saved = await repository.save(settings);
      return { before, after: saved.updatedAt.getTime() };
    });
    expect(after).toBeGreaterThan(before);
  });
});

describe('a later feature (SC-006)', () => {
  it('writes a deal and its invoice with two saves and no SQL', async () => {
    const buyer = await companyWithWallet();
    const seller = await companyWithWallet();
    const lot = await publishedLot(seller.company.id);

    const deal = await db.getRepository(Deal).save({
      lotId: lot.id,
      buyerCompanyId: buyer.company.id,
      sellerCompanyId: seller.company.id,
      quantity: 2,
      unitPriceMinor: lot.unitPriceMinor,
      totalMinor: 2 * lot.unitPriceMinor,
      status: 'awaiting_payment',
      idempotencyKey: randomUUID(),
    });
    const invoice = await db.getRepository(Invoice).save({
      dealId: deal.id,
      amountMinor: deal.totalMinor,
      status: 'issued',
      issuedAt: new Date(),
      dueAt: new Date(Date.now() + 5 * DAY_MS),
      expiresAt: new Date(Date.now() + 6 * DAY_MS),
    });

    expect(invoice.number).toMatch(/^INV-\d{4}-\d{6,}$/);
  });
});
