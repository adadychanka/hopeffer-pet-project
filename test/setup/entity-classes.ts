/// <reference types="vite/client" />
import { getMetadataArgsStorage } from 'typeorm';

export type EntityClass = new () => object;

// The classes of every *.entity.ts file, found the same way the TypeORM CLI
// finds them (by file name), so a test sees what a generated migration sees.
// Only classes that TypeORM registered as tables count, so a helper function
// or a constant exported from an entity file is never passed as an entity.
// Shared by the unit and the e2e tests, so it must not import vitest's
// inject(). It lives under test/ because import.meta.glob exists only in Vite.
export function entityClasses(): EntityClass[] {
  const modules = import.meta.glob<Record<string, unknown>>(
    '../../src/**/*.entity.ts',
    { eager: true },
  );
  const tables = new Set<unknown>(
    getMetadataArgsStorage().tables.map((table) => table.target),
  );
  return Object.values(modules)
    .flatMap((exports) => Object.values(exports))
    .filter((value): value is EntityClass => tables.has(value));
}
