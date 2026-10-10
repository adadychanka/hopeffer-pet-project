# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

## Project

NestJS 12 backend (TypeScript, pure ESM) using pnpm. Backing services: PostgreSQL via TypeORM, Redis cache, RustFS object storage (S3 API), OpenSearch. `docker-compose.yml` runs all four locally, and its defaults match `.env.example`.

Requires Node >=24 and pnpm 12. `devEngines.runtime` in `package.json` sets `onFail: error`, so an older Node fails the install. `devEngines.packageManager` pins pnpm to an exact version (no `^` range) and sets `onFail: download`: any pnpm 12 switches itself to the version that `pnpm-lock.yaml` records (`packageManagerDependencies`), so everyone installs with the same pnpm and the lockfile stays unchanged. pnpm 10 and older ignore `devEngines` and must not be used. To move to a newer pnpm, run `pnpm self-update <version>` in the repo. It updates `devEngines.packageManager` and the lockfile, but writes a `^` range: remove the `^` from `devEngines.packageManager.version` and from the `packageManagerDependencies` specifier, then commit both files. CI reads the pnpm version from `devEngines`, and `pnpm/setup` resolves a range to the newest release, which then fails its version check against the lockfile pin. CI pins Node separately (`runtime: node@24` in `.github/workflows/ci.yml`): update both when moving to a new Node major.

## Commands

```bash
pnpm install
pnpm run docker:up        # start postgres, redis, rustfs, opensearch
pnpm run start:dev        # watch mode

pnpm run test             # unit tests (*.spec.ts)
pnpm run test:e2e         # e2e tests (*.e2e-spec.ts, vitest.config.e2e.ts); needs Docker
pnpm run test:cov         # coverage; fails below 98% statements/branches/functions/lines
pnpm exec vitest run src/s3/s3.service.spec.ts   # single file
pnpm exec vitest run -t "builds its client from the S3_\* env vars"   # single test by name

pnpm run lint             # oxlint (fast; same as pre-commit); warnings do not fail it
pnpm run lint:eslint      # full type-aware eslint, with --fix
pnpm run typecheck
pnpm run commitlint:check # commit messages in origin/main..HEAD
pnpm run secrets:scan     # TruffleHog over all history reachable from HEAD (Docker)
pnpm run ci               # format:check, commitlint:check, secrets:scan, lint, typecheck, eslint (0 warnings), build, test:cov, test:e2e

pnpm run migration:generate src/database/migrations/<Name>   # diff entities vs DB
pnpm run migration:create src/database/migrations/<Name>     # empty migration
pnpm run migration:run            # apply pending
pnpm run migration:revert         # undo last
```

`pnpm run format` and `format:check` cover only `src/**/*.ts` and `test/**/*.ts`. Run `pnpm exec prettier --write <file>` on root config files you change (`vitest.config.ts`, `*.mjs`, `*.json`, `*.md`, `.github/**/*.yml`).

### Definition of done

Run `pnpm run ci` before you report a task as complete. **If `pnpm run ci` fails, the task is not complete.** Fix the failure and run it again, or report the task as unfinished with the failing output. Do not mark the task done, and do not weaken a check (thresholds, lint rules, skipped tests) to make it pass. GitHub Actions (`.github/workflows/ci.yml`) runs the same `pnpm run ci` on pull requests and pushes to `main`. Add new checks to the `ci` script, never as separate workflow steps. Before `pnpm run ci`, CI installs with `--frozen-lockfile`, so commit `pnpm-lock.yaml` together with any dependency change in `package.json`. The command runs the e2e tests and the TruffleHog scan, so Docker must be running. `commitlint:check` compares against `origin/main`: run `git fetch` if it is stale, and it fails if `origin/main` does not exist. `lint` (oxlint) passes on warnings, but `lint:eslint:check` fails on any warning (`--max-warnings 0`), so a clean `pnpm run lint` does not mean `pnpm run ci` passes.

### Dependencies

`pnpm-workspace.yaml` enforces supply chain policies:

- `minimumReleaseAge: 4320` rejects versions published less than 3 days ago. If an install fails on a new release, pick an older version. Do not lower the setting.
- `trustPolicy: no-downgrade` rejects a version published with weaker provenance than an earlier version of the same package. Add an exception to `trustPolicyExclude` only for a verified false positive, with a comment that explains why.

## Architecture

- `AppModule` imports `LoggerModule` and four global infra modules: `DatabaseModule`, `RedisCacheModule`, `S3Module` and `OpensearchModule`. Feature modules inject the infra providers (`DataSource`, `CACHE_MANAGER`, `S3Service`, `OpensearchService`) without importing the modules.
- Logging uses Pino through `nestjs-pino`. `main.ts` sets it as the app logger with `bufferLogs: true`, so Nest's `Logger` from `@nestjs/common` writes through Pino. `LOG_LEVEL` sets the level (default `info`, and `silent` when `NODE_ENV=test`). Output is pretty only in a TTY outside production; otherwise it is JSON lines on stdout. Logs go to stdout only, and the platform collects them. Do not add file output or a second transport target: Pino rejects level labels together with `transport.targets`. Authorization and cookie headers are redacted.
- `S3Service` and `OpensearchService` **extend the SDK client classes directly** (AWS SDK `S3Client`, opensearch `Client`). Call SDK methods on the injected service. There is no wrapper API.
- Redis is not a custom service. Inject `CACHE_MANAGER` (cache-manager with a `@keyv/redis` store). `RedisCacheModule` provides that token itself instead of using `CacheModule.registerAsync()`, because `CacheModule` disconnects Redis in `onModuleDestroy`, which Nest runs while requests still run. `RedisCacheShutdown` disconnects in `onApplicationShutdown`.
- Health checks use `@nestjs/terminus`. `GET /live` checks nothing and does not call terminus, so it stays 200 during the shutdown drain. `GET /ready` runs every provider marked with `@ReadinessCheck('<key>')` (`src/health/readiness.ts`); `ReadinessRegistry` finds them at startup with `DiscoveryService`. Each infra module provides its own indicator (`*.health.ts`) and imports the static `TerminusModule`; only `HealthModule` uses `TerminusModule.forRootAsync()`, to set the shutdown drain. A new backing service adds its check the same way, with no change to `src/health/`. Every check is critical: one down check makes `/ready` answer 503. The S3 check calls `ListBuckets`, which needs `s3:ListAllMyBuckets` on AWS; switch it to `HeadBucket` when a bucket setting exists.
- Graceful shutdown uses Nest's hooks: `main.ts` calls `enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true })`. On SIGTERM, terminus answers `/ready` with 503 `shutting_down` for `SHUTDOWN_DRAIN_MS` (`beforeApplicationShutdown`). Then Nest closes the HTTP server, waits for requests in flight, and runs `onApplicationShutdown`. Close every client in `onApplicationShutdown`, never in `onModuleDestroy`: Nest runs `onModuleDestroy` before the drain and before HTTP closes. Do not set `forceCloseConnections` or `return503OnClosing`. The e2e test `test/shutdown.e2e-spec.ts` runs `dist/main.js`, so `test:e2e` builds first.
- Configuration goes through `@nestjs/config`. `AppModule` registers `ConfigModule.forRoot` globally. It loads `.env` when the file exists (real env vars take precedence) and validates the result with the zod schema in `src/config/env.ts`, so the app refuses to start on a missing or malformed value. Add every new setting to that schema. Read settings by injecting `ConfigService<Env, true>` and calling `config.get('NAME', { infer: true })`, never `process.env`. Module factories use `inject: [ConfigService]`. Connection settings have no defaults in code; `.env.example` holds the local values. Tests skip `.env` (`ignoreEnvFile` when `NODE_ENV=test`). The TypeORM CLI (`src/database/data-source.ts`) runs outside Nest, so it still loads `.env` with `dotenv/config` and validates `DATABASE_URL` with `validateMigrationEnv`.
- TypeORM setup: `DatabaseModule` registers `TypeOrmModule.forRootAsync` with `autoLoadEntities: true` and `synchronize` off. A feature module registers its entities with `TypeOrmModule.forFeature([...])` and injects repositories with `@InjectRepository()`. Schema changes go through migrations only.
- The TypeORM CLI uses `src/database/data-source.ts` and runs against compiled `dist/` output, because tsx/esbuild cannot emit decorator metadata. Every `migration:*` script except `migration:create` builds first. The CLI data source finds entities by the `*.entity.ts` file name, so name entity files that way. Generated migrations are not Prettier-formatted: run `pnpm run format` (lint-staged also fixes them on commit).
- The e2e tests boot the full `AppModule` against throwaway Testcontainers, not the docker-compose services. `test/setup/global-setup.ts` starts Postgres, Redis, RustFS and OpenSearch once per run (same images as `docker-compose.yml`), runs the migrations, and passes the URLs to workers. `test/setup/env.ts` then sets `DATABASE_URL`, `REDIS_URL`, `S3_*` and `OPENSEARCH_NODE`. Docker must be running. No `.env` or docker-compose is needed.
- Tests that need the database use the real Postgres container, not mocked repositories. Mock only third-party APIs you do not control. All test files in a run share one database, so each test must create its own data and not depend on rows from other tests.

## Specs and plans

- Save design specs and implementation plans in `reports/<task-name>/`, not in `docs/`. `<task-name>` is a short kebab-case name, for example `reports/github-actions-ci/`.
- Name files `YYYY-MM-DD-design.md` for specs and `YYYY-MM-DD-plan.md` for plans. A later revision gets a new dated file, so the folder keeps the history.
- After a plan is executed, save each review round of the result in the same folder as `YYYY-MM-DD-review.md`. Record the findings with severity and `file:line`, what was fixed (with the commit), what was deferred, and the rulings made. A second review on the same day gets a suffix: `YYYY-MM-DD-review-2.md`.
- `reports/` is in `.gitignore`. Never commit specs, plans or reviews, and never reference them from committed files.
- This overrides the default locations of planning and review skills (for example `docs/superpowers/specs/` and `docs/superpowers/plans/`).

## Conventions

- ESM with `module: nodenext`: relative imports **must** use a `.js` extension (`./app.service.js`).
- Vitest globals are disabled. Import `describe`/`it`/`expect`/`vi` from `vitest` explicitly.
- Unit tests sit next to the source as `*.spec.ts`. E2E tests go in `test/` as `*.e2e-spec.ts`. Coverage ignores `main.ts`, `*.module.ts`, `src/database/data-source.ts` and `src/database/migrations/**` (reasons are in `vitest.config.ts`). Put logic in services, not module factories, and test it to keep the 98% threshold. A class whose Nest decorator (`@Injectable()`, `@Controller()`) sits over a constructor with parameters gets a compiler-generated metadata branch that no test can reach. Wrap only that decorator in `/* v8 ignore start -- TS __decorate helper branch, not app logic */` … `/* v8 ignore stop */`, as `src/app.controller.ts` does.
- To mark an unused variable or argument, prefix it with `_`. Floating promises are an error in both linters.
- Commits follow Conventional Commits, enforced by commitlint. Git hooks: pre-commit runs lint-staged (`oxlint --fix` + `prettier`). Pre-push runs TruffleHog through Docker, so Docker must be running to push. `scripts/trufflehog.sh` is the only place that pins the TruffleHog image (version and digest); both `.husky/pre-push` and `secrets:scan` call it. Bump the version and digest together by hand. It also works from git worktrees. Dependabot updates the pinned action SHAs in `.github/workflows/`. When you add an action, pin it by full commit SHA with the version as a comment (`uses: owner/action@<40-char sha> # v1.2.3`), never by tag alone. Pin Docker images in `docker-compose.yml` the same way, by version and multi-arch index digest (`image: name:1.2.3@sha256:<digest>`; get the digest with `docker buildx imagetools inspect name:1.2.3`). Dependabot updates them. `test/setup/global-setup.ts` must use the same image pins.
- To test the secret scan, generate a random fake key (for example `AKIA` plus 16 characters from `/dev/urandom`). Never write a key from memory or from docs: it can be a real key or a canary token that alerts its owner.
