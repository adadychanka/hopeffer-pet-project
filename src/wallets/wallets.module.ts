import { Module } from '@nestjs/common';
import { DealsModule } from '../deals/deals.module.js';
import { TopUpsController } from './top-ups.controller.js';
import { TopUpsService } from './top-ups.service.js';

// Wallet operations. A top-up can pay an invoice, so this module depends on
// deals; keeping it out of LedgerModule avoids a ledger-deals cycle
// (feature 003 research R1).
@Module({
  imports: [DealsModule],
  controllers: [TopUpsController],
  providers: [TopUpsService],
})
export class WalletsModule {}
