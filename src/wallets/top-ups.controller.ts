import { Body, Controller, Post } from '@nestjs/common';
import { ActorContext, type OperatorActor } from '../http/actor.js';
import { ZodValidationPipe } from '../http/zod-validation.pipe.js';
import { topUpBody, type TopUpBody } from './top-up.schema.js';
import { type TopUpResult, TopUpsService } from './top-ups.service.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Controller('top-ups')
/* v8 ignore stop */
export class TopUpsController {
  constructor(private readonly topUps: TopUpsService) {}

  // Record a bank notification and credit the company's wallet.
  @Post()
  record(
    @ActorContext('operator') actor: OperatorActor,
    @Body(new ZodValidationPipe(topUpBody, 'body')) body: TopUpBody,
  ): Promise<TopUpResult> {
    return this.topUps.record(actor, body);
  }
}
