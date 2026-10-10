import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { OpensearchHealthIndicator } from './opensearch.health.js';
import { OpensearchService } from './opensearch.service.js';

@Global()
@Module({
  imports: [TerminusModule],
  providers: [OpensearchService, OpensearchHealthIndicator],
  exports: [OpensearchService],
})
export class OpensearchModule {}
