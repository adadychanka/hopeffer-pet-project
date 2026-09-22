import { Global, Module } from '@nestjs/common';
import { OpensearchService } from './opensearch.service.js';

@Global()
@Module({
  providers: [OpensearchService],
  exports: [OpensearchService],
})
export class OpensearchModule {}
