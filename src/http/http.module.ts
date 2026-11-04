import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ProblemDetailsFilter } from './problem-details.filter.js';

// Provided here, not in main.ts, so every test that boots AppModule answers
// errors the same way as the running app.
@Module({
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class HttpModule {}
