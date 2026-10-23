import { Body, Controller, Param, Post } from '@nestjs/common';
import { type Actor, ActorContext } from '../http/actor.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import {
  LotPricingService,
  type PriceChangeView,
} from './lot-pricing.service.js';
import {
  lotIdParam,
  priceChangeBody,
  type PriceChangeBody,
} from './price-change.schema.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Controller('lots')
/* v8 ignore stop */
export class LotsController {
  constructor(private readonly pricing: LotPricingService) {}

  // Set a new unit price: the lot's seller (a company actor) or an operator.
  @Post(':lotId/price-changes')
  changePrice(
    @ActorContext('company', 'operator') actor: Actor,
    @Param('lotId', new ZodValidationPipe(lotIdParam, 'path')) lotId: string,
    @Body(new ZodValidationPipe(priceChangeBody, 'body')) body: PriceChangeBody,
  ): Promise<PriceChangeView> {
    return this.pricing.changePrice(actor, lotId, body.unitPriceMinor);
  }
}
