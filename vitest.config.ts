import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    root: './',
    include: ['**/*.spec.ts'],
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
