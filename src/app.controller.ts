import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

/* v8 ignore start -- TS __decorate helper branch, not app logic */
@Controller()
/* v8 ignore stop */
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): { message: string } {
    return this.appService.getHello();
  }
}
