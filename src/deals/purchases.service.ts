import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { parseSafeBigint } from '../database/safe-bigint.js';
import type { CompanyActor } from '../http/actor.js';
import { DomainError } from '../http/domain-error.js';
import { lockAccounts, platformAccountIds } from '../ledger/posting.js';
import type { DealStatus } from './deal.entity.js';
import type { InvoiceStatus } from './invoice.entity.js';
import { InvoicePaymentService } from './invoice-payment.service.js';
import type { PurchaseBody } from './purchase.schema.js';

export interface DealView {
  id: string;
  lotId: string;
  buyerCompanyId: string;
  sellerCompanyId: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  status: DealStatus;
  createdAt: Date;
}

export interface InvoiceView {
  id: string;
  number: string;
  amountMinor: number;
  status: InvoiceStatus;
  issuedAt: Date;
  dueAt: Date;
  expiresAt: Date;
  paidAt: Date | null;
}

export interface PurchaseResult {
  replayed: boolean;
  deal: DealView;
  invoice: InvoiceView;
}

interface DealInvoiceRow {
  id: string;
  lot_id: string;
  buyer_company_id: string;
  seller_company_id: string;
  quantity: number;
  unit_price_minor: string;
  total_minor: string;
  status: DealStatus;
  created_at: Date;
  invoice_id: string;
  invoice_number: string;
  invoice_amount_minor: string;
  invoice_status: InvoiceStatus;
  issued_at: Date;
  due_at: Date;
  expires_at: Date;
  paid_at: Date | null;
}

interface SettingsRow {
  payment_window_days: number;
  grace_period_days: number;
  max_unpaid_deals: number;
  expiry_limit: number;
  expiry_lookback_days: number;
}

interface LotRow {
  status: string;
  seller_company_id: string;
  stock_available: number;
  unit_price_minor: string;
}

function money(value: string): number {
  return parseSafeBigint(value) as number;
}

// Buy a lot (feature 003, User Story 1). One transaction; the buyer wallet
// lock serializes the purchases of one buyer, which keeps the unpaid limit,
// the prepay-only count and the idempotency lookup exact (research R2, R9).
/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly invoicePayment: InvoicePaymentService,
  ) {}

  async buy(
    actor: CompanyActor,
    idempotencyKey: string,
    body: PurchaseBody,
  ): Promise<PurchaseResult> {
    const result = await this.dataSource.transaction((manager) =>
      this.buyIn(manager, actor, idempotencyKey, body),
    );
    if (!result.replayed) {
      this.logger.log({
        msg: 'Deal created',
        dealId: result.deal.id,
        lotId: result.deal.lotId,
        buyerCompanyId: result.deal.buyerCompanyId,
        totalMinor: result.deal.totalMinor,
        paid: result.deal.status === 'paid',
      });
    }
    return result;
  }

  private async buyIn(
    manager: EntityManager,
    actor: CompanyActor,
    idempotencyKey: string,
    { lotId, quantity, payNow }: PurchaseBody,
  ): Promise<PurchaseResult> {
    const buyerId = actor.companyId;
    const walletId = await this.walletOf(manager, buyerId);
    const { escrowId } = await platformAccountIds(manager);
    const locked = await lockAccounts(
      manager,
      payNow ? [walletId, escrowId] : [walletId],
    );

    const existing = await manager.query<
      { id: string; lot_id: string; quantity: number }[]
    >(
      `SELECT id, lot_id, quantity FROM deals
       WHERE buyer_company_id = $1 AND idempotency_key = $2`,
      [buyerId, idempotencyKey],
    );
    if (existing.length > 0) {
      const deal = existing[0];
      if (deal.lot_id !== lotId || deal.quantity !== quantity) {
        throw new DomainError(
          'idempotency_key_reused',
          'This Idempotency-Key belongs to a purchase of another lot or quantity.',
        );
      }
      return { replayed: true, ...(await this.view(manager, deal.id)) };
    }

    const settings = (
      await manager.query<SettingsRow[]>(
        `SELECT payment_window_days, grace_period_days, max_unpaid_deals,
                expiry_limit, expiry_lookback_days
         FROM platform_settings`,
      )
    )[0];
    if (!payNow) {
      await this.checkPayLaterAllowed(manager, buyerId, settings);
    }

    // TypeORM answers UPDATE ... RETURNING with [rows, affected count].
    const [reserved] = await manager.query<
      [{ unit_price_minor: string; seller_company_id: string }[], number]
    >(
      `UPDATE lots
       SET stock_available = stock_available - $2, updated_at = now()
       WHERE id = $1 AND status = 'published' AND stock_available >= $2
         AND seller_company_id <> $3
         AND $2::numeric * unit_price_minor <= ${Number.MAX_SAFE_INTEGER}
       RETURNING unit_price_minor, seller_company_id`,
      [lotId, quantity, buyerId],
    );
    if (reserved.length === 0) {
      throw await this.whyNotReserved(manager, lotId, quantity, buyerId);
    }
    const unitPriceMinor = money(reserved[0].unit_price_minor);
    const totalMinor = quantity * unitPriceMinor;

    const dealId = (
      await manager.query<{ id: string }[]>(
        `INSERT INTO deals (lot_id, buyer_company_id, seller_company_id, quantity,
           unit_price_minor, total_minor, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, 'awaiting_payment', $7) RETURNING id`,
        [
          lotId,
          buyerId,
          reserved[0].seller_company_id,
          quantity,
          unitPriceMinor,
          totalMinor,
          idempotencyKey,
        ],
      )
    )[0].id;
    await manager.query(
      `INSERT INTO deal_status_changes (deal_id, from_status, to_status, actor_type, actor_ref)
       VALUES ($1, NULL, 'awaiting_payment', 'buyer', $2)`,
      [dealId, actor.ref],
    );
    const invoiceId = (
      await manager.query<{ id: string }[]>(
        `INSERT INTO invoices (deal_id, amount_minor, status, issued_at, due_at, expires_at)
         VALUES ($1, $2, 'issued', now(),
                 now() + make_interval(days => $3),
                 now() + make_interval(days => $3 + $4))
         RETURNING id`,
        [
          dealId,
          totalMinor,
          settings.payment_window_days,
          settings.grace_period_days,
        ],
      )
    )[0].id;

    if (payNow) {
      await this.invoicePayment.pay(manager, locked, {
        invoiceId,
        amountMinor: totalMinor,
        dealId,
        buyerWalletId: walletId,
        escrowId,
        actor: { type: 'buyer', ref: actor.ref },
      });
    }
    return { replayed: false, ...(await this.view(manager, dealId)) };
  }

  // The buyer's wallet id; the company must exist and have a wallet.
  private async walletOf(
    manager: EntityManager,
    companyId: string,
  ): Promise<string> {
    const rows = await manager.query<{ wallet_id: string | null }[]>(
      `SELECT a.id AS wallet_id FROM companies c
       LEFT JOIN accounts a ON a.company_id = c.id
       WHERE c.id = $1`,
      [companyId],
    );
    if (rows.length === 0) {
      throw new DomainError('company_not_found');
    }
    if (rows[0].wallet_id === null) {
      throw new DomainError(
        'wallet_not_activated',
        'The company needs a wallet before it buys.',
      );
    }
    return rows[0].wallet_id;
  }

  // The unpaid limit and the prepay-only rule (FR-019). Only a purchase that
  // is not paid at once is subject to them.
  private async checkPayLaterAllowed(
    manager: EntityManager,
    buyerId: string,
    settings: SettingsRow,
  ): Promise<void> {
    const counts = (
      await manager.query<{ unpaid: number; recent_expired: number }[]>(
        `SELECT
           (SELECT count(*)::int FROM deals
            WHERE buyer_company_id = $1 AND status = 'awaiting_payment') AS unpaid,
           (SELECT count(*)::int FROM deals d JOIN invoices i ON i.deal_id = d.id
            WHERE d.buyer_company_id = $1 AND d.status = 'expired'
              AND i.expires_at > now() - make_interval(days => $2)) AS recent_expired`,
        [buyerId, settings.expiry_lookback_days],
      )
    )[0];
    if (counts.unpaid >= settings.max_unpaid_deals) {
      throw new DomainError(
        'unpaid_deal_limit_reached',
        `A buyer may have at most ${settings.max_unpaid_deals} unpaid deals. Pay at once, or pay an open invoice first.`,
      );
    }
    if (counts.recent_expired >= settings.expiry_limit) {
      throw new DomainError(
        'prepay_only',
        `After ${settings.expiry_limit} expired deals in ${settings.expiry_lookback_days} days, purchases must be paid at once.`,
      );
    }
  }

  // Explains why the conditional UPDATE reserved nothing, in the order of
  // the contract. The lot is read without a lock: if its stock changed in
  // between, the answer is still insufficient_stock.
  private async whyNotReserved(
    manager: EntityManager,
    lotId: string,
    quantity: number,
    buyerId: string,
  ): Promise<DomainError> {
    const lot = (
      await manager.query<LotRow[]>(
        `SELECT status, seller_company_id, stock_available, unit_price_minor
         FROM lots WHERE id = $1`,
        [lotId],
      )
    ).at(0);
    if (lot === undefined || lot.status !== 'published') {
      return new DomainError('lot_not_found');
    }
    if (lot.seller_company_id === buyerId) {
      return new DomainError('own_lot');
    }
    if (
      BigInt(quantity) * BigInt(lot.unit_price_minor) >
      BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return new DomainError(
        'amount_too_large',
        'The total is above the largest amount the platform stores exactly.',
      );
    }
    return new DomainError(
      'insufficient_stock',
      `The lot has ${lot.stock_available} units available; ${quantity} were requested.`,
    );
  }

  private async view(
    manager: EntityManager,
    dealId: string,
  ): Promise<{ deal: DealView; invoice: InvoiceView }> {
    const row = (
      await manager.query<DealInvoiceRow[]>(
        `SELECT d.id, d.lot_id, d.buyer_company_id, d.seller_company_id, d.quantity,
                d.unit_price_minor, d.total_minor, d.status, d.created_at,
                i.id AS invoice_id, i.number AS invoice_number,
                i.amount_minor AS invoice_amount_minor, i.status AS invoice_status,
                i.issued_at, i.due_at, i.expires_at, i.paid_at
         FROM deals d JOIN invoices i ON i.deal_id = d.id
         WHERE d.id = $1`,
        [dealId],
      )
    )[0];
    return {
      deal: {
        id: row.id,
        lotId: row.lot_id,
        buyerCompanyId: row.buyer_company_id,
        sellerCompanyId: row.seller_company_id,
        quantity: row.quantity,
        unitPriceMinor: money(row.unit_price_minor),
        totalMinor: money(row.total_minor),
        status: row.status,
        createdAt: row.created_at,
      },
      invoice: {
        id: row.invoice_id,
        number: row.invoice_number,
        amountMinor: money(row.invoice_amount_minor),
        status: row.invoice_status,
        issuedAt: row.issued_at,
        dueAt: row.due_at,
        expiresAt: row.expires_at,
        paidAt: row.paid_at,
      },
    };
  }
}
