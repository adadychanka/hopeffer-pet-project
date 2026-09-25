# hopeffer-pet-project

NestJS backend service.

## Tech stack decisions

| Area | Choice | Why |
| --- | --- | --- |
| Framework | [NestJS](https://nestjs.com/) | Structured, opinionated Node.js framework; built-in DI, module system, testing support |
| Package manager | [pnpm](https://pnpm.io/) | Fast installs, disk-efficient via content-addressable store, strict dependency resolution |
| Language | TypeScript | Type safety, matches NestJS defaults |
| Test runner | [Vitest](https://vitest.dev/) | Fast, native ESM support, Jest-compatible API |
| Formatter | [Prettier](https://prettier.io/) | Consistent code style, no formatting debates |
| ORM / database | [TypeORM](https://typeorm.io/) via [@nestjs/typeorm](https://docs.nestjs.com/techniques/database) + PostgreSQL | Decorator-based entities that fit Nest's DI, repository injection per module, migration CLI built in |
| Cache | Redis via [@nestjs/cache-manager](https://docs.nestjs.com/techniques/caching) + [@keyv/redis](https://github.com/jaredwray/keyv) | Standard Nest caching abstraction, backed by Redis |
| Object storage | [MinIO](https://min.io/) via the [`minio`](https://www.npmjs.com/package/minio) SDK | S3-compatible object storage, runs locally, same client API as AWS S3 in production |
| Search | [OpenSearch](https://opensearch.org/) via [`@opensearch-project/opensearch`](https://www.npmjs.com/package/@opensearch-project/opensearch) | Full-text search / analytics, Elasticsearch-compatible API, open-source license |
| Local infra | [Docker Compose](https://docs.docker.com/compose/) | One command to run Postgres + Redis + MinIO + OpenSearch for local development |
| Secret scanning | [TruffleHog](https://github.com/trufflesecurity/trufflehog) (Docker image) | Blocks `git push` if a commit being pushed contains a credential |

### Linting: ESLint vs Oxlint

Two linters run at different stages, each for a different purpose:

- **ESLint** — full check, runs in CI/CD. Type-aware rules (`typescript-eslint` with `recommendedTypeChecked`), [eslint-plugin-security](https://github.com/eslint-community/eslint-plugin-security) for common vulnerability patterns, [eslint-plugin-import](https://github.com/import-js/eslint-plugin-import) + [eslint-plugin-unused-imports](https://github.com/sweepline/eslint-plugin-unused-imports) for import hygiene, Prettier integration, Vitest-specific rules for test files. Catches everything before merge.
- **Oxlint** — fast, local-only check, runs on the pre-commit hook via [Husky](https://typicode.github.io/husky/). Catches obvious mistakes before commit without slowing down the commit itself.

Commands:

```bash
pnpm run lint          # oxlint — fast, local, pre-commit
pnpm run lint:eslint   # eslint — full, CI/CD
```

On commit, [lint-staged](https://github.com/lint-staged/lint-staged) runs `oxlint --fix` and `prettier --write` on staged `*.ts` files via the Husky `pre-commit` hook.

### Commit messages: Commitlint

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope?): subject`), enforced by [Commitlint](https://commitlint.js.org/) on the Husky `commit-msg` hook.

```
feat: add user login endpoint
fix(auth): handle expired refresh token
chore: bump dependencies
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

### Database: TypeORM + PostgreSQL

`DatabaseModule` (`src/database/database.module.ts`) registers `TypeOrmModule.forRootAsync` with the connection string from `DATABASE_URL` (`.env`, gitignored). `autoLoadEntities` is on, so each feature module registers its entities with `TypeOrmModule.forFeature([...])` and injects repositories with `@InjectRepository()`. `synchronize` is off: schema changes go through migrations.

Migrations live in `src/database/migrations/`. The TypeORM CLI uses `src/database/data-source.ts` and runs against the compiled `dist/` output, so every migration script except `migration:create` builds first.

```bash
pnpm run migration:generate src/database/migrations/<Name>   # diff entities vs DB into a new migration
pnpm run migration:create src/database/migrations/<Name>     # empty migration
pnpm run migration:run                                       # apply pending migrations
pnpm run migration:revert                                    # undo the last migration
```

### Cache: Redis

`RedisCacheModule` (`src/cache/redis-cache.module.ts`) registers Nest's `CacheModule` globally with a `@keyv/redis` store, connection string in `REDIS_URL` (`.env`). Inject `CACHE_MANAGER` where caching is needed.

### Object storage: MinIO

`MinioService` (`src/minio/`) extends the `minio` SDK's `Client` directly, configured from `MINIO_ENDPOINT`/`MINIO_PORT`/`MINIO_USE_SSL`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` (`.env`), exported globally via `MinioModule`. Console at `http://localhost:9001` (default creds `minioadmin`/`minioadmin`).

### Search: OpenSearch

`OpensearchService` (`src/opensearch/`) extends the official client's `Client` directly, configured from `OPENSEARCH_NODE` (`.env`), exported globally via `OpensearchModule`. Local Compose instance runs with the security plugin disabled (dev only).

### Local infra: Docker Compose

`docker-compose.yml` runs Postgres, Redis, MinIO and OpenSearch for local development, matching the default `.env` connection strings.

```bash
pnpm run docker:up     # start postgres + redis + minio + opensearch in the background
pnpm run docker:down   # stop and remove them
```

### Secret scanning: TruffleHog

`.husky/pre-push` runs [TruffleHog](https://github.com/trufflesecurity/trufflehog) (via its Docker image, no local install needed) over the commits being pushed and blocks the push if it finds a credential. Requires Docker running locally.

## Project setup

```bash
pnpm install
pnpm run docker:up
```

Set `DATABASE_URL`, `REDIS_URL`, the `MINIO_*` vars and `OPENSEARCH_NODE` in `.env` before running migrations or starting the app; defaults match `docker-compose.yml`.

## Run

```bash
pnpm run start:dev   # watch mode
pnpm run start:prod  # production build
```

## Test

```bash
pnpm run test        # unit tests
pnpm run test:e2e    # e2e tests
pnpm run test:cov    # coverage (98% threshold on statements/branches/functions/lines)
```
