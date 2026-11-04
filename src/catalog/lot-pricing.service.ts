import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { parseSafeBigint } from '../database/safe-bigint.js';
import type { Actor } from '../http/actor.js';
import { DomainError } from '../http/domain-error.js';
import type { PriceActorType } from './lot-price-change.entity.js';

export interface PriceChangeView {
  // A bigint identity key, sent as a string.
  id: string;
  lotId: string;
  oldPriceMinor: number;
  newPriceMinor: number;
  actorType: PriceActorType;
  changedAt: Date;
}

interface LotRow {
  seller_company_id: string;
  status: string;
  unit_price_minor: string;
}

// Update the price of a lot (feature 003, User Story 3). The lot row lock
// orders concurrent changes and purchases, so each history row starts from
// the previous row's price and a purchase never sees half a change.
/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Injectable()
/* v8 ignore stop */
export class LotPricingService {
  private readonly logger = new Logger(LotPricingService.name);

  constructor(private readonly dataSource: DataSource) {}

  async changePrice(
    actor: Actor,
    lotId: string,
    unitPriceMinor: number,
  ): Promise<PriceChangeView> {
    const change = await this.dataSource.transaction((manager) =>
      this.changeIn(manager, actor, lotId, unitPriceMinor),
    );
    this.logger.log({
      msg: 'Lot price changed',
      lotId,
      oldPriceMinor: change.oldPriceMinor,
      newPriceMinor: change.newPriceMinor,
    });
    return change;
  }

  private async changeIn(
    manager: EntityManager,
    actor: Actor,
    lotId: string,
    unitPriceMinor: number,
  ): Promise<PriceChangeView> {
    const lot = (
      await manager.query<LotRow[]>(
        `SELECT seller_company_id, status, unit_price_minor FROM lots
         WHERE id = $1 FOR UPDATE`,
        [lotId],
      )
    ).at(0);
    if (lot === undefined) {
      throw new DomainError('lot_not_found');
    }
    if (actor.role === 'company' && actor.companyId !== lot.seller_company_id) {
      // A hidden lot stays invisible to other companies.
      throw new DomainError(
        lot.status === 'hidden' ? 'lot_not_found' : 'not_lot_seller',
      );
    }
    const oldPriceMinor = parseSafeBigint(lot.unit_price_minor) as number;
    if (oldPriceMinor === unitPriceMinor) {
      throw new DomainError(
        'price_unchanged',
        `The lot already costs ${unitPriceMinor}.`,
      );
    }
    const actorType: PriceActorType =
      actor.role === 'company' ? 'seller' : 'operator';

    await manager.query(
      'UPDATE lots SET unit_price_minor = $2, updated_at = now() WHERE id = $1',
      [lotId, unitPriceMinor],
    );
    const row = (
      await manager.query<{ id: string; changed_at: Date }[]>(
        `INSERT INTO lot_price_changes (lot_id, old_price_minor, new_price_minor, actor_type, actor_ref)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, changed_at`,
        [lotId, oldPriceMinor, unitPriceMinor, actorType, actor.ref],
      )
    )[0];
    return {
      id: row.id,
      lotId,
      oldPriceMinor,
      newPriceMinor: unitPriceMinor,
      actorType,
      changedAt: row.changed_at,
    };
  }
}
