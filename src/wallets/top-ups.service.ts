import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { parseSafeBigint } from '../database/safe-bigint.js';
import { InvoicePaymentService } from '../deals/invoice-payment.service.js';
import type { OperatorActor } from '../http/actor.js';
import { DomainError } from '../http/domain-error.js';
import { lockAccounts, platformAccountIds } from '../ledger/posting.js';
import { walletIdOf } from '../ledger/wallets.js';
import type { TopUpBody } from './top-up.schema.js';

export interface TopUpView {
  id: string;
  companyId: string;
  amountMinor: number;
  bankReference: string;
  transferDate: string;
  invoiceId: string | null;
  recordedAt: Date;
}

export interface TopUpResult {
  topUp: TopUpView;
  walletBalanceMinor: number;
  paidInvoiceId: string | null;
}

interface InvoiceRow {
  id: string;
  status: string;
  amount_minor: string;
  deal_id: string;
  buyer_company_id: string;
}

interface TopUpRow {
  id: string;
  company_id: string;
  amount_minor: string;
  bank_reference: string;
  transfer_date: string;
  invoice_id: string | null;
  recorded_at: Date;
}

// Top up wallet (feature 003, User Story 2): the operator records a bank
// notification. Locks the wallet, bank clearing and, when an invoice is
// named, escrow; then the invoice (research R2).
/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class TopUpsService {
  private readonly logger = new Logger(TopUpsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly invoicePayment: InvoicePaymentService,
  ) {}

  async record(actor: OperatorActor, body: TopUpBody): Promise<TopUpResult> {
    const result = await this.dataSource.transaction((manager) =>
      this.recordIn(manager, actor, body),
    );
    this.logger.log({
      msg: 'Top-up recorded',
      topUpId: result.topUp.id,
      companyId: result.topUp.companyId,
      amountMinor: result.topUp.amountMinor,
      paidInvoiceId: result.paidInvoiceId,
    });
    return result;
  }

  private async recordIn(
    manager: EntityManager,
    actor: OperatorActor,
    body: TopUpBody,
  ): Promise<TopUpResult> {
    const walletId = await walletIdOf(manager, body.companyId);
    const { escrowId, bankClearingId } = await platformAccountIds(manager);
    const locked = await lockAccounts(
      manager,
      body.invoiceId === undefined
        ? [walletId, bankClearingId]
        : [walletId, bankClearingId, escrowId],
    );
    const invoice =
      body.invoiceId === undefined
        ? undefined
        : await this.lockInvoice(manager, body.invoiceId);

    const row = (
      await manager.query<TopUpRow[]>(
        `INSERT INTO top_ups (company_id, amount_minor, bank_reference, transfer_date, invoice_id, operator_ref)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, company_id, amount_minor, bank_reference,
                   transfer_date::text AS transfer_date, invoice_id, recorded_at`,
        [
          body.companyId,
          body.amountMinor,
          body.bankReference,
          body.transferDate,
          body.invoiceId ?? null,
          actor.ref,
        ],
      )
    )[0];
    const operator = { type: 'operator' as const, ref: actor.ref };
    await locked.post(manager, {
      type: 'top_up',
      sourceId: row.id,
      actor: operator,
      legs: [
        { accountId: bankClearingId, amountMinor: -body.amountMinor },
        { accountId: walletId, amountMinor: body.amountMinor },
      ],
    });

    let paidInvoiceId: string | null = null;
    if (invoice !== undefined) {
      const amountMinor = parseSafeBigint(invoice.amount_minor) as number;
      // FR-010a: only an issued invoice of the same company, covered by the
      // balance after the top-up. Anything else leaves the money in the wallet.
      if (
        invoice.status === 'issued' &&
        invoice.buyer_company_id === body.companyId &&
        locked.balanceOf(walletId) >= amountMinor
      ) {
        await this.invoicePayment.pay(manager, locked, {
          invoiceId: invoice.id,
          amountMinor,
          dealId: invoice.deal_id,
          buyerWalletId: walletId,
          escrowId,
          actor: operator,
        });
        paidInvoiceId = invoice.id;
      }
    }

    return {
      topUp: {
        id: row.id,
        companyId: row.company_id,
        amountMinor: parseSafeBigint(row.amount_minor) as number,
        bankReference: row.bank_reference,
        transferDate: row.transfer_date,
        invoiceId: row.invoice_id,
        recordedAt: row.recorded_at,
      },
      walletBalanceMinor: locked.balanceOf(walletId),
      paidInvoiceId,
    };
  }

  private async lockInvoice(
    manager: EntityManager,
    invoiceId: string,
  ): Promise<InvoiceRow> {
    const rows = await manager.query<InvoiceRow[]>(
      `SELECT i.id, i.status, i.amount_minor, d.id AS deal_id, d.buyer_company_id
       FROM invoices i JOIN deals d ON d.id = i.deal_id
       WHERE i.id = $1
       FOR UPDATE`,
      [invoiceId],
    );
    if (rows.length === 0) {
      throw new DomainError('invoice_not_found');
    }
    return rows[0];
  }
}
