# hopeffer-pet-project

NestJS backend service.

## Tech stack decisions

| Area            | Choice                                                                                                                                     | Why                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | [NestJS](https://nestjs.com/)                                                                                                              | Structured, opinionated Node.js framework; built-in DI, module system, testing support                                                                          |
| Runtime         | [Node.js](https://nodejs.org/) 24 LTS                                                                                                      | Current Active LTS; `engines.node` in `package.json` tells CI and hosts which Node to use; `devEngines.runtime` blocks local installs and scripts on older Node |
| Package manager | [pnpm](https://pnpm.io/) 12                                                                                                                | Fast installs, disk-efficient via content-addressable store, strict dependency resolution                                                                       |
| Language        | TypeScript                                                                                                                                 | Type safety, matches NestJS defaults                                                                                                                            |
| Test runner     | [Vitest](https://vitest.dev/)                                                                                                              | Fast, native ESM support, Jest-compatible API                                                                                                                   |
| Formatter       | [Prettier](https://prettier.io/)                                                                                                           | Consistent code style, no formatting debates                                                                                                                    |
| ORM / database  | [TypeORM](https://typeorm.io/) via [@nestjs/typeorm](https://docs.nestjs.com/techniques/database) + PostgreSQL                             | Decorator-based entities that fit Nest's DI, repository injection per module, migration CLI built in                                                            |
| Cache           | Redis via [@nestjs/cache-manager](https://docs.nestjs.com/techniques/caching) + [@keyv/redis](https://github.com/jaredwray/keyv)           | Standard Nest caching abstraction, backed by Redis                                                                                                              |
| Object storage  | [MinIO](https://min.io/) via the [`minio`](https://www.npmjs.com/package/minio) SDK                                                        | S3-compatible object storage, runs locally, same client API as AWS S3 in production                                                                             |
| Search          | [OpenSearch](https://opensearch.org/) via [`@opensearch-project/opensearch`](https://www.npmjs.com/package/@opensearch-project/opensearch) | Full-text search / analytics, Elasticsearch-compatible API, open-source license                                                                                 |
| Logging         | [Pino](https://getpino.io/) via [nestjs-pino](https://github.com/iamolegga/nestjs-pino)                                                    | Fast structured JSON logs, automatic request logging with a request ID on every line                                                                            |
| Local infra     | [Docker Compose](https://docs.docker.com/compose/)                                                                                         | One command to run Postgres + Redis + MinIO + OpenSearch for local development                                                                                  |
| Secret scanning | [TruffleHog](https://github.com/trufflesecurity/trufflehog) (Docker image)                                                                 | Blocks `git push` if a commit being pushed contains a credential; scans the full history in `pnpm run ci`                                                       |

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

`pnpm run commitlint:check` checks every commit on the current branch that `origin/main` does not have. It runs in `pnpm run ci`, so commits made with `--no-verify` or in the GitHub web UI are still checked.

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

### Logging: Pino

`LoggerModule` (`src/logger/logger.module.ts`) plugs [nestjs-pino](https://github.com/iamolegga/nestjs-pino) in as the Nest logger. Why Pino over Nest's built-in `ConsoleLogger` or Winston: it is the fastest Node.js logger, it writes JSON lines to stdout that a collector can ship to OpenSearch as they are, and `pino-http` logs every request and attaches the request ID to every log line made while handling it. The `Authorization` and `Cookie` headers are redacted.

Keep using Nest's `Logger` from `@nestjs/common` in services (`new Logger(MyService.name)`); its output goes through Pino. Set the level with `LOG_LEVEL` (default `info`, `silent` under tests). Output is pretty-printed with `pino-pretty` in a terminal, and plain JSON when `NODE_ENV=production` or stdout is not a TTY.

To also write logs to files, set `LOG_FILE` (for example `logs/app`). [pino-roll](https://github.com/mcollina/pino-roll) then writes JSON lines to `logs/app.<date>.<n>.log`, starts a new file every day or at 10 MB, keeps the 14 newest files, and points `logs/current.log` at the active one. Rotation deletes old files in that folder even if another process wrote them, so give the logs a folder of their own. Leave `LOG_FILE` unset in containers and let Docker collect stdout.

### Local infra: Docker Compose

`docker-compose.yml` runs Postgres, Redis, MinIO and OpenSearch for local development, matching the default `.env` connection strings.

```bash
pnpm run docker:up     # start postgres + redis + minio + opensearch in the background
pnpm run docker:down   # stop and remove them
```

### Secret scanning: TruffleHog

`.husky/pre-push` runs [TruffleHog](https://github.com/trufflesecurity/trufflehog) (via its Docker image, no local install needed) over the commits being pushed and blocks the push if it finds a credential. Requires Docker running locally.

`pnpm run secrets:scan` scans the full git history with the same pinned image and runs in `pnpm run ci`.

### CI: GitHub Actions

`.github/workflows/ci.yml` runs `pnpm run ci` on pull requests and pushes to `main`, so CI and local checks are the same command. Actions are pinned by commit SHA; Dependabot (`.github/dependabot.yml`) proposes updates after a 3-day cooldown.

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

## Run in a Docker sandbox

Why Docker Sandboxes: they are easy to set up and run, and ship ready-made images for Claude Code. They still isolate the agent from the host well. Credentials such as the GitHub token stay on the host, and the sandbox proxy injects them, so they are never stored inside the sandbox. Network access is easy to control. Machine resources have no fixed static limits, so the developer experience is close to native development. For local development, this is the best option I found.

The project can be developed inside a [Docker Sandbox](https://docs.docker.com/ai/sandboxes/) together with a coding agent (e.g. Claude Code). The sandbox gets its own Docker daemon, so `pnpm run docker:up` starts Postgres, Redis, MinIO and OpenSearch inside it, and `localhost` in `.env.example` works unchanged. From the project root on the host, start the agent with `sbx run claude`. By default the working tree is mounted directly, so edits and commits show up on the host immediately. With `--clone` the sandbox works on a separate clone instead, and you fetch its commits with `git fetch sandbox-<name>`. Inside the sandbox, run the usual setup (`pnpm install`, `pnpm run docker:up`, `cp .env.example .env`, `pnpm run start:dev`). The app listens on port 3000 inside the sandbox; to reach it from the host, publish the port from a host terminal:

```bash
sbx run claude                                               # start the agent in a sandbox for this repo
sbx ports <sandbox-name> --publish 3000:3000/tcp             # expose the Nest app on host port 3000
sbx secret set github --sandbox claude-hopeffer-pet-project  # allow git push from the sandbox (PAT, see below)
```

The sandbox name is shown by `sbx ls` (or `echo $SANDBOX_NAME` inside the sandbox). Outbound network access is deny-by-default: if `pnpm install` or another request is blocked, allow the domain with `sbx policy allow network <domain>`. The TruffleHog pre-push hook uses the sandbox's Docker daemon, so `git push` works from inside the sandbox.

Disable SSH agent forwarding for the sandbox by setting `ssh.agentForwardingEnabled = false`. Otherwise the agent inside the sandbox can use the host's SSH keys. Git push does not need them, because the sandbox proxy injects the GitHub token for HTTPS remotes.

For that GitHub token, use a fine-grained personal access token made only for agent work in this project. Do not reuse `gh auth token`, which has your full account access. Limit the token to this repository, with only the **Contents: Read and write** permission. Pass it to the sandbox from a host terminal:

```bash
sbx secret set github --sandbox claude-hopeffer-pet-project
```

## Test

```bash
pnpm run test        # unit tests
pnpm run test:e2e    # e2e tests
pnpm run test:cov    # coverage (98% threshold on statements/branches/functions/lines)
```
