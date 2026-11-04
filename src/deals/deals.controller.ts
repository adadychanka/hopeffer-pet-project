import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ActorContext, type CompanyActor } from '../http/actor.js';
import { parseInput, ZodValidationPipe } from '../http/zod-validation.pipe.js';
import {
  purchaseBody,
  purchaseHeaders,
  type PurchaseBody,
} from './purchase.schema.js';
import {
  PurchasesService,
  type DealView,
  type InvoiceView,
} from './purchases.service.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Controller('deals')
/* v8 ignore stop */
export class DealsController {
  constructor(private readonly purchases: PurchasesService) {}

  // Buy a lot. 201 for a new deal; 200 with Idempotent-Replayed: true when
  // the Idempotency-Key repeats an earlier purchase.
  @Post()
  async buy(
    @ActorContext('company') actor: CompanyActor,
    @Headers() headers: Record<string, unknown>,
    @Body(new ZodValidationPipe(purchaseBody, 'body')) body: PurchaseBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ deal: DealView; invoice: InvoiceView }> {
    const { 'idempotency-key': idempotencyKey } = parseInput(
      purchaseHeaders,
      headers,
      'headers',
    );
    const { replayed, deal, invoice } = await this.purchases.buy(
      actor,
      idempotencyKey,
      body,
    );
    if (replayed) {
      response.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
    }
    return { deal, invoice };
  }
}
