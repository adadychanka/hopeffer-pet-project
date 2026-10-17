import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LotPhoto } from './lot-photo.entity.js';
import { LotPriceChange } from './lot-price-change.entity.js';
import { Lot } from './lot.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Lot, LotPhoto, LotPriceChange])],
  exports: [TypeOrmModule],
})
export class CatalogModule {}
