import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealStatusChange } from './deal-status-change.entity.js';
import { Deal } from './deal.entity.js';
import { Invoice } from './invoice.entity.js';
import { InvoicePaymentService } from './invoice-payment.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Deal, DealStatusChange, Invoice])],
  providers: [InvoicePaymentService],
  exports: [TypeOrmModule, InvoicePaymentService],
})
export class DealsModule {}
