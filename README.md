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
| ORM / database | [Prisma](https://www.prisma.io/) + PostgreSQL | Type-safe queries generated from schema, migration tooling built in |
| Cache | Redis via [@nestjs/cache-manager](https://docs.nestjs.com/techniques/caching) + [@keyv/redis](https://github.com/jaredwray/keyv) | Standard Nest caching abstraction, backed by Redis |
| Local infra | [Docker Compose](https://docs.docker.com/compose/) | One command to run Postgres + Redis for local development |

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

### Database: Prisma + PostgreSQL

Schema lives in `prisma/schema.prisma`, config in `prisma.config.ts`, connection string in `DATABASE_URL` (`.env`, gitignored). Client generates into `src/generated/prisma` (gitignored, regenerated on `pnpm install` via `postinstall`), wired into Nest through `PrismaModule`/`PrismaService` (`src/prisma/`), imported globally in `AppModule`.

```bash
pnpm run prisma:generate   # regenerate client after schema changes
pnpm run prisma:migrate    # create + apply a migration (dev)
pnpm run prisma:studio     # browse data in Prisma Studio
```

### Cache: Redis

`RedisCacheModule` (`src/cache/redis-cache.module.ts`) registers Nest's `CacheModule` globally with a `@keyv/redis` store, connection string in `REDIS_URL` (`.env`). Inject `CACHE_MANAGER` where caching is needed.

### Local infra: Docker Compose

`docker-compose.yml` runs Postgres and Redis for local development, matching the default `.env` connection strings.

```bash
pnpm run docker:up     # start postgres + redis in the background
pnpm run docker:down   # stop and remove them
```

## Project setup

```bash
pnpm install
pnpm run docker:up
```

Set `DATABASE_URL` and `REDIS_URL` in `.env` before running migrations or starting the app; defaults match `docker-compose.yml`.

## Run

```bash
pnpm run start:dev   # watch mode
pnpm run start:prod  # production build
```

## Test

```bash
pnpm run test        # unit tests
pnpm run test:e2e    # e2e tests
pnpm run test:cov    # coverage
```
