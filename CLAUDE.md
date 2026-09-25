# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NestJS 12 backend (TypeScript, pure ESM) using pnpm. Backing services: PostgreSQL via TypeORM, Redis cache, MinIO object storage, OpenSearch. `docker-compose.yml` runs all four locally, and its defaults match `.env.example`.

## Commands

```bash
pnpm install
pnpm run docker:up        # start postgres, redis, minio, opensearch
pnpm run start:dev        # watch mode

pnpm run test             # unit tests (*.spec.ts)
pnpm run test:e2e         # e2e tests (*.e2e-spec.ts, vitest.config.e2e.ts)
pnpm run test:cov         # coverage; fails below 98% statements/branches/functions/lines
pnpm exec vitest run src/minio/minio.service.spec.ts   # single file
pnpm exec vitest run -t "connects on module init"      # single test by name

pnpm run lint             # oxlint (fast; same as pre-commit)
pnpm run lint:eslint      # full type-aware eslint, with --fix
pnpm run typecheck
pnpm run ci               # format:check, lint, typecheck, eslint (0 warnings), build, test:cov

pnpm run migration:generate src/database/migrations/<Name>   # diff entities vs DB
pnpm run migration:create src/database/migrations/<Name>     # empty migration
pnpm run migration:run            # apply pending
pnpm run migration:revert         # undo last
```

Run `pnpm run ci` before claiming a change is done. It mirrors the full CI gate.

## Architecture

- `AppModule` imports four global infra modules: `DatabaseModule`, `RedisCacheModule`, `MinioModule` and `OpensearchModule`. Feature modules inject their providers (`DataSource`, `CACHE_MANAGER`, `MinioService`, `OpensearchService`) without importing the modules.
- `MinioService` and `OpensearchService` **extend the SDK client classes directly** (minio `Client`, opensearch `Client`). Call SDK methods on the injected service. There is no wrapper API.
- Redis is not a custom service. Inject Nest's `CACHE_MANAGER` (the store is `@keyv/redis`).
- Configuration comes from `process.env` inside each service constructor. There is no `@nestjs/config`. **The app does not load `.env` itself.** Only `src/database/data-source.ts` (the TypeORM CLI) imports `dotenv/config`. When running the app, export the variables or use `node --env-file=.env`.
- TypeORM setup: `DatabaseModule` registers `TypeOrmModule.forRootAsync` with `autoLoadEntities: true` and `synchronize` off. A feature module registers its entities with `TypeOrmModule.forFeature([...])` and injects repositories with `@InjectRepository()`. Schema changes go through migrations only.
- The TypeORM CLI uses `src/database/data-source.ts` and runs against compiled `dist/` output, because tsx/esbuild cannot emit decorator metadata. Every `migration:*` script except `migration:create` builds first. The CLI data source finds entities by the `*.entity.ts` file name, so name entity files that way. Generated migrations are not Prettier-formatted: run `pnpm run format` (lint-staged also fixes them on commit).
- The e2e tests boot the full `AppModule`, which connects to Postgres, so the docker infra must be running and `DATABASE_URL` must be exported.

## Conventions

- ESM with `module: nodenext`: relative imports **must** use a `.js` extension (`./app.service.js`).
- Vitest globals are disabled. Import `describe`/`it`/`expect`/`vi` from `vitest` explicitly.
- Unit tests sit next to the source as `*.spec.ts`. E2E tests go in `test/` as `*.e2e-spec.ts`. Coverage ignores `main.ts` and `*.module.ts`, so logic in services needs tests to keep the 98% threshold.
- To mark an unused variable or argument, prefix it with `_`. Floating promises are an error in both linters.
- Commits follow Conventional Commits, enforced by commitlint. Git hooks: pre-commit runs lint-staged (`oxlint --fix` + `prettier`). Pre-push runs TruffleHog through Docker, so Docker must be running to push.
