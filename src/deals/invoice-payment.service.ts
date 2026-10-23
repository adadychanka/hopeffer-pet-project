import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type {
  LockedAccounts,
  TransferActor,
} from '../ledger/locked-accounts.js';

export interface InvoiceToPay {
  invoiceId: string;
  amountMinor: number;
  dealId: string;
  buyerWalletId: string;
  escrowId: string;
  actor: TransferActor;
}

// Pays an issued invoice from the buyer's wallet into escrow, and moves the
// invoice and its deal to paid. Used by a purchase paid at once (the buyer
// acts) and by a top-up that names the invoice (the operator acts). The
// caller has locked the buyer wallet and escrow, then the invoice, and
// checked that the invoice is issued (feature 003 research R2).
@Injectable()
export class InvoicePaymentService {
  async pay(
    manager: EntityManager,
    locked: LockedAccounts,
    invoice: InvoiceToPay,
  ): Promise<void> {
    await locked.post(manager, {
      type: 'invoice_payment',
      sourceId: invoice.invoiceId,
      actor: invoice.actor,
      legs: [
        { accountId: invoice.buyerWalletId, amountMinor: -invoice.amountMinor },
        { accountId: invoice.escrowId, amountMinor: invoice.amountMinor },
      ],
    });
    await manager.query(
      `UPDATE invoices SET status = 'paid', paid_at = now()
       WHERE id = $1 AND status = 'issued'`,
      [invoice.invoiceId],
    );
    await manager.query(
      `UPDATE deals SET status = 'paid', updated_at = now()
       WHERE id = $1 AND status = 'awaiting_payment'`,
      [invoice.dealId],
    );
    await manager.query(
      `INSERT INTO deal_status_changes (deal_id, from_status, to_status, actor_type, actor_ref)
       VALUES ($1, 'awaiting_payment', 'paid', $2, $3)`,
      [invoice.dealId, invoice.actor.type, invoice.actor.ref],
    );
  }
}
