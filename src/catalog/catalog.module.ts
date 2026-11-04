import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LotPhoto } from './lot-photo.entity.js';
import { LotPricingService } from './lot-pricing.service.js';
import { LotPriceChange } from './lot-price-change.entity.js';
import { Lot } from './lot.entity.js';
import { LotsController } from './lots.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Lot, LotPhoto, LotPriceChange])],
  controllers: [LotsController],
  providers: [LotPricingService],
  exports: [TypeOrmModule],
})
export class CatalogModule {}
