import { Injectable } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';

@Injectable()
export class OpensearchService extends Client {
  constructor() {
    super({
      node: process.env.OPENSEARCH_NODE ?? 'http://localhost:9200',
    });
  }
}
