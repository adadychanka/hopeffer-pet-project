// Starts throwaway Postgres and Redis containers once per e2e run, applies the
// migrations, and hands the connection URLs to the test workers through
// `provide`. MinIO and OpenSearch are not started: their clients do not
// connect until a test calls them.
/// <reference types="vite/client" />
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { DataSource, type MigrationInterface } from 'typeorm';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

// Same images as docker-compose.yml, so tests run against the dev versions.
const POSTGRES_IMAGE = 'postgres:17-alpine';
const REDIS_IMAGE = 'redis:8-alpine';

type MigrationClass = new () => MigrationInterface;

// Vite compiles the .ts migrations here. A glob path would make TypeORM load
// them with Node's own import(), and Node's type stripping fails on the
// `import { MigrationInterface } from 'typeorm'` line in generated migrations.
function loadMigrations(): MigrationClass[] {
  const modules = import.meta.glob<Record<string, MigrationClass>>(
    '../../src/database/migrations/*.ts',
    { eager: true },
  );
  return Object.values(modules).flatMap((exports) => Object.values(exports));
}

export default async function setup(project: TestProject) {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);

  // Build the schema with the real migrations, not `synchronize`, so the
  // tests also prove that the migrations match the entities.
  const dataSource = new DataSource({
    type: 'postgres',
    url: postgres.getConnectionUri(),
    migrations: loadMigrations(),
  });
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();

  project.provide('databaseUrl', postgres.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
