// Runs in each test worker before the test files. ConfigModule validates
// process.env (tests skip .env), so point the app at the containers that
// global-setup.ts started, and give the lazy OpenSearch client an address it
// never calls. The S3 settings are optional, so the S3 client needs none.
import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
process.env.OPENSEARCH_NODE = 'http://localhost:9200';
