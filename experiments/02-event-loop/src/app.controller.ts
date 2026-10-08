import { Controller, Get } from '@nestjs/common';
import { HeavyService } from './heavy.service.js';

@Controller()
export class AppController {
  constructor(private readonly heavy: HeavyService) {}

  // Does no work. Its latency shows how long a request waits for the event
  // loop. The pid shows which cluster worker answered.
  @Get('light')
  light(): { pid: number } {
    return { pid: process.pid };
  }

  @Get('heavy')
  async heavyEndpoint(): Promise<{ length: number }> {
    const hash = await this.heavy.run();
    return { length: hash.length };
  }
}
