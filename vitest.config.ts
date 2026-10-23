import { configDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    root: './',
    // Experiments are separate apps with their own package.json.
    exclude: [...configDefaults.exclude, 'experiments/**'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['**/*.e2e-spec.ts'],
          // Testcontainers: Postgres, Redis, RustFS and OpenSearch, started
          // once for the whole run.
          globalSetup: ['./test/setup/global-setup.ts'],
          setupFiles: ['./test/setup/env.ts'],
        },
      },
    ],
    // Measured over both projects: database code is tested only against the
    // real Postgres container (constitution, Principle II), so the e2e tests
    // are what cover it.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        // Bootstrap entry point: starts a real HTTP server. The e2e tests
        // cover the app wiring instead.
        'src/main.ts',
        // Declarative Nest wiring (imports/providers). Keep logic out of
        // module factories and in services, where it gets tested.
        'src/**/*.module.ts',
        // TypeORM CLI config. Only the migration scripts load it, never the app.
        'src/database/data-source.ts',
        // Generated schema changes. Exercised by `migration:run`, not by unit tests.
        'src/database/migrations/**',
        // Test files themselves, not code under test.
        'src/**/*.spec.ts',
      ],
      thresholds: {
        statements: 98,
        branches: 98,
        functions: 98,
        lines: 98,
      },
    },
  },
});
