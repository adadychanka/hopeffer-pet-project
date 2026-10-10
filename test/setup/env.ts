// Runs in each test worker before the test files. ConfigModule validates
// process.env (tests skip .env), so point the app at the containers that
// global-setup.ts started.
import { inject } from 'vitest';
import { RUSTFS_ACCESS_KEY, RUSTFS_SECRET_KEY } from './rustfs.js';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
process.env.S3_ENDPOINT = inject('s3Endpoint');
// S3_REGION is optional, and without it the SDK needs AWS_REGION. RustFS
// accepts any region.
process.env.S3_REGION = 'us-east-1';
process.env.S3_ACCESS_KEY = RUSTFS_ACCESS_KEY;
process.env.S3_SECRET_KEY = RUSTFS_SECRET_KEY;
process.env.OPENSEARCH_NODE = inject('opensearchNode');
