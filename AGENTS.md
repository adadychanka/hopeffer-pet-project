# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

## Project

NestJS 12 backend (TypeScript, pure ESM) using pnpm. Backing services: PostgreSQL via TypeORM, Redis cache, MinIO object storage, OpenSearch. `docker-compose.yml` runs all four locally, and its defaults match `.env.example`.

Requires Node >=24 and pnpm ^12. `devEngines` in `package.json` sets `onFail: error`, so older versions fail the install.

## Commands

```bash
pnpm install
pnpm run docker:up        # start postgres, redis, minio, opensearch
pnpm run start:dev        # watch mode

pnpm run test             # unit tests (*.spec.ts)
pnpm run test:e2e         # e2e tests (*.e2e-spec.ts, vitest.config.e2e.ts); needs Docker
pnpm run test:cov         # coverage; fails below 98% statements/branches/functions/lines
pnpm exec vitest run src/minio/minio.service.spec.ts   # single file
pnpm exec vitest run -t "builds its client from the MINIO_\* env vars"   # single test by name

pnpm run lint             # oxlint (fast; same as pre-commit)
pnpm run lint:eslint      # full type-aware eslint, with --fix
pnpm run typecheck
pnpm run commitlint:check # commit messages in origin/main..HEAD
pnpm run secrets:scan     # TruffleHog over all history reachable from HEAD (Docker)
pnpm run ci               # format:check, lint, typecheck, eslint (0 warnings), build, test:cov, test:e2e, commitlint:check, secrets:scan

pnpm run migration:generate src/database/migrations/<Name>   # diff entities vs DB
pnpm run migration:create src/database/migrations/<Name>     # empty migration
pnpm run migration:run            # apply pending
pnpm run migration:revert         # undo last
```

`pnpm run format` and `format:check` cover only `src/**/*.ts` and `test/**/*.ts`. Run `pnpm exec prettier --write <file>` on root config files you change (`vitest.config.ts`, `*.mjs`, `*.json`, `*.md`).

### Definition of done

Run `pnpm run ci` before you report a task as complete. **If `pnpm run ci` fails, the task is not complete.** Fix the failure and run it again, or report the task as unfinished with the failing output. Do not mark the task done, and do not weaken a check (thresholds, lint rules, skipped tests) to make it pass. GitHub Actions (`.github/workflows/ci.yml`) runs the same `pnpm run ci` on pull requests and pushes to `main`, and checks nothing beyond it. Add new checks to the `ci` script, never as separate workflow steps. The command runs the e2e tests and the TruffleHog scan, so Docker must be running. `commitlint:check` compares against `origin/main`, so run `git fetch` if it is stale.

### Dependencies

`pnpm-workspace.yaml` enforces supply chain policies:

- `minimumReleaseAge: 4320` rejects versions published less than 3 days ago. If an install fails on a new release, pick an older version. Do not lower the setting.
- `trustPolicy: no-downgrade` rejects a version published with weaker provenance than an earlier version of the same package. Add an exception to `trustPolicyExclude` only for a verified false positive, with a comment that explains why.

## Architecture

- `AppModule` imports `LoggerModule` and four global infra modules: `DatabaseModule`, `RedisCacheModule`, `MinioModule` and `OpensearchModule`. Feature modules inject the infra providers (`DataSource`, `CACHE_MANAGER`, `MinioService`, `OpensearchService`) without importing the modules.
- Logging uses Pino through `nestjs-pino`. `main.ts` sets it as the app logger with `bufferLogs: true`, so Nest's `Logger` from `@nestjs/common` writes through Pino. `LOG_LEVEL` sets the level (default `info`, and `silent` when `NODE_ENV=test`). Output is pretty only in a TTY outside production; otherwise it is JSON lines on stdout. `LOG_FILE` (for example `logs/app`) also writes rotating files. That folder must hold only these logs, because rotation deletes other files in it. Authorization and cookie headers are redacted.
- `MinioService` and `OpensearchService` **extend the SDK client classes directly** (minio `Client`, opensearch `Client`). Call SDK methods on the injected service. There is no wrapper API.
- Redis is not a custom service. Inject Nest's `CACHE_MANAGER` (the store is `@keyv/redis`).
- Configuration comes from `process.env` inside each service constructor. There is no `@nestjs/config`. **The app does not load `.env` itself.** Only `src/database/data-source.ts` (the TypeORM CLI) imports `dotenv/config`. When running the app, export the variables or use `node --env-file=.env`.
- TypeORM setup: `DatabaseModule` registers `TypeOrmModule.forRootAsync` with `autoLoadEntities: true` and `synchronize` off. A feature module registers its entities with `TypeOrmModule.forFeature([...])` and injects repositories with `@InjectRepository()`. Schema changes go through migrations only.
- The TypeORM CLI uses `src/database/data-source.ts` and runs against compiled `dist/` output, because tsx/esbuild cannot emit decorator metadata. Every `migration:*` script except `migration:create` builds first. The CLI data source finds entities by the `*.entity.ts` file name, so name entity files that way. Generated migrations are not Prettier-formatted: run `pnpm run format` (lint-staged also fixes them on commit).
- The e2e tests boot the full `AppModule` against throwaway Testcontainers, not the docker-compose services. `test/setup/global-setup.ts` starts Postgres and Redis once per run (same images as `docker-compose.yml`), runs the migrations, and passes the URLs to workers. `test/setup/env.ts` then sets `DATABASE_URL` and `REDIS_URL`. Docker must be running. No `.env` or docker-compose is needed. MinIO and OpenSearch have no containers yet: their clients connect lazily. Add a container in `global-setup.ts` when a test starts to call them.
- Tests that need the database use the real Postgres container, not mocked repositories. Mock only third-party APIs you do not control. All test files in a run share one database, so each test must create its own data and not depend on rows from other tests.

## Specs and plans

- Save design specs and implementation plans in `reports/<task-name>/`, not in `docs/`. `<task-name>` is a short kebab-case name, for example `reports/github-actions-ci/`.
- Name files `YYYY-MM-DD-design.md` for specs and `YYYY-MM-DD-plan.md` for plans. A later revision gets a new dated file, so the folder keeps the history.
- `reports/` is in `.gitignore`. Never commit specs or plans, and never reference them from committed files.
- This overrides the default locations of planning skills (for example `docs/superpowers/specs/` and `docs/superpowers/plans/`).

## Conventions

- ESM with `module: nodenext`: relative imports **must** use a `.js` extension (`./app.service.js`).
- Vitest globals are disabled. Import `describe`/`it`/`expect`/`vi` from `vitest` explicitly.
- Unit tests sit next to the source as `*.spec.ts`. E2E tests go in `test/` as `*.e2e-spec.ts`. Coverage ignores `main.ts`, `*.module.ts`, `src/database/data-source.ts` and `src/database/migrations/**` (reasons are in `vitest.config.ts`). Put logic in services, not module factories, and test it to keep the 98% threshold.
- To mark an unused variable or argument, prefix it with `_`. Floating promises are an error in both linters.
- Commits follow Conventional Commits, enforced by commitlint. Git hooks: pre-commit runs lint-staged (`oxlint --fix` + `prettier`). Pre-push runs TruffleHog through Docker, so Docker must be running to push. The TruffleHog image is pinned by version and digest in both `.husky/pre-push` and the `secrets:scan` script; bump both together. Dependabot updates the pinned action SHAs in `.github/workflows/`.
