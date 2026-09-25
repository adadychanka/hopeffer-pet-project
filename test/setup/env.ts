// Runs in each test worker before the test files. Services read their
// configuration from process.env, so point them at the containers that
// global-setup.ts started instead of the docker-compose services.
import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
