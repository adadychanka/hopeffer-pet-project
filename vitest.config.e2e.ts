import { configDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Experiments are separate apps with their own package.json.
    exclude: [...configDefaults.exclude, 'experiments/**'],
    // Testcontainers: one Postgres and one Redis container for the whole run.
    globalSetup: ['./test/setup/global-setup.ts'],
    setupFiles: ['./test/setup/env.ts'],
  },
});
