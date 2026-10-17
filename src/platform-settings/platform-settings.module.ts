import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSettings } from './platform-settings.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformSettings])],
  exports: [TypeOrmModule],
})
export class PlatformSettingsModule {}
