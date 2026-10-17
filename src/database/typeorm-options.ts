import type { DataSourceOptions } from 'typeorm';

export type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

// Every DataSource starts here: the app (DatabaseModule), the TypeORM CLI
// (data-source.ts) and the tests. They must agree, or the drift check compares
// a schema built with different defaults.
// - uuidExtension 'pgcrypto' makes uuid keys default to gen_random_uuid(),
//   which is built into PostgreSQL 13+; the 'uuid-ossp' default would need an
//   extension and generate uuid_generate_v4().
// - installExtensions false stops the driver from running CREATE EXTENSION
//   when it connects.
export function buildTypeOrmOptions(url: string) {
  return {
    type: 'postgres',
    url,
    uuidExtension: 'pgcrypto',
    installExtensions: false,
  } satisfies PostgresOptions;
}
