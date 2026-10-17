/// <reference types="vite/client" />
import type { MigrationInterface } from 'typeorm';

type MigrationClass = new () => MigrationInterface;

// Vite compiles the .ts migrations here. A glob path would make TypeORM load
// them with Node's own import(), and Node's type stripping fails on the
// `import { MigrationInterface } from 'typeorm'` line in generated migrations.
export function loadMigrations(): MigrationClass[] {
  const modules = import.meta.glob<Record<string, MigrationClass>>(
    '../../src/database/migrations/*.ts',
    { eager: true },
  );
  return Object.values(modules).flatMap((exports) => Object.values(exports));
}
