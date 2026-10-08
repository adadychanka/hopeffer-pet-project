// Starts throwaway Postgres, Redis, RustFS (S3) and OpenSearch containers once
// per e2e run, applies the migrations, and hands the connection URLs to the
// test workers through `provide`.
/// <reference types="vite/client" />
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { GenericContainer, Wait } from 'testcontainers';
import { DataSource, type MigrationInterface } from 'typeorm';
import type { TestProject } from 'vitest/node';
import { RUSTFS_ACCESS_KEY, RUSTFS_SECRET_KEY } from './rustfs.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
    s3Endpoint: string;
    opensearchNode: string;
  }
}

// Same images as docker-compose.yml, so tests run against the dev versions.
const POSTGRES_IMAGE =
  'postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const REDIS_IMAGE =
  'redis:8.10.2-alpine@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0';
const RUSTFS_IMAGE =
  'rustfs/rustfs:1.0.0@sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff';
const OPENSEARCH_IMAGE =
  'opensearchproject/opensearch:3.9.0@sha256:adfa61f85025d06b4aeb562e7e74fde7e31c437039c93c3862c17e9acebd6c7c';

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

function startRustfs() {
  return new GenericContainer(RUSTFS_IMAGE)
    .withEnvironment({
      RUSTFS_ACCESS_KEY,
      RUSTFS_SECRET_KEY,
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/health', 9000))
    .start();
}

function startOpensearch() {
  return (
    new GenericContainer(OPENSEARCH_IMAGE)
      .withEnvironment({
        'discovery.type': 'single-node',
        DISABLE_SECURITY_PLUGIN: 'true',
        OPENSEARCH_INITIAL_ADMIN_PASSWORD: 'OpenSearch_Dev1!',
        // The default heap is 1 GB. Half of it is enough for tests and fits
        // on CI runners.
        OPENSEARCH_JAVA_OPTS: '-Xms512m -Xmx512m',
      })
      .withExposedPorts(9200)
      .withWaitStrategy(Wait.forHttp('/_cluster/health', 9200))
      // The JVM needs longer to start than the 60 s default allows on slow runners.
      .withStartupTimeout(120_000)
      .start()
  );
}

export default async function setup(project: TestProject) {
  const [postgres, redis, rustfs, opensearch] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
    startRustfs(),
    startOpensearch(),
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
  project.provide(
    's3Endpoint',
    `http://${rustfs.getHost()}:${rustfs.getMappedPort(9000)}`,
  );
  project.provide(
    'opensearchNode',
    `http://${opensearch.getHost()}:${opensearch.getMappedPort(9200)}`,
  );

  return async () => {
    await Promise.all([
      postgres.stop(),
      redis.stop(),
      rustfs.stop(),
      opensearch.stop(),
    ]);
  };
}
