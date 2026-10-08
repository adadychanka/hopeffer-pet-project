import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { HeavyService } from './heavy.service.js';

@Module({
  controllers: [AppController],
  providers: [HeavyService],
})
export class AppModule {}
