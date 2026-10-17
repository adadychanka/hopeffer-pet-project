import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './account.entity.js';
import { Correction } from './correction.entity.js';
import { LedgerEntry } from './ledger-entry.entity.js';
import { LedgerTransfer } from './ledger-transfer.entity.js';
import { TopUp } from './top-up.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      TopUp,
      Correction,
      LedgerTransfer,
      LedgerEntry,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class LedgerModule {}
