// Runs in each test worker before the test files. ConfigModule validates
// process.env (tests skip .env), so point the app at the containers that
// global-setup.ts started, and give the lazy S3 and OpenSearch clients
// addresses they never call.
import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
process.env.S3_ENDPOINT = 'http://localhost:9000';
process.env.S3_ACCESS_KEY = 'unused';
process.env.S3_SECRET_KEY = 'unused';
process.env.OPENSEARCH_NODE = 'http://localhost:9200';
