# hopeffer-pet-project Constitution

## Core Principles

### I. CI Defines Done (NON-NEGOTIABLE)

- A task is done only when `pnpm run ci` passes. It runs format, commitlint, secret scan, oxlint,
  typecheck, eslint with zero warnings, build, unit tests with coverage and e2e tests.
- If `pnpm run ci` fails, the task MUST be reported as unfinished, with the failing output.
- Checks MUST NOT be weakened to pass: no lowered thresholds, disabled lint rules or skipped tests.
- New checks go in the `ci` script, never as separate GitHub Actions steps.

Rationale: one command runs locally and in CI, so "done" means the same thing everywhere.

### II. Tests Against Real Dependencies

- Coverage MUST stay at or above 98% for statements, branches, functions and lines.
- Tests that touch the database MUST use the real Postgres container, not mocked repositories.
  Only third-party APIs outside the project's control may be mocked.
- E2E tests of app behaviour (HTTP, startup and shutdown, logging, module wiring) boot the full
  `AppModule` against Testcontainers that use the same image pins as `docker-compose.yml`. They
  boot it once per test file, not once per test.
- Database tests (schema rules, repositories, queries) MAY open a `DataSource` built from the
  app's shared TypeORM options instead of booting the app. At least one e2e test MUST boot
  `AppModule` and prove that every entity is registered.
- Each test MUST create its own data and MUST NOT depend on rows from other tests.
- Logic lives in services, not module factories, so it is testable.

Rationale: mocked infrastructure hides the failures that matter most in a backend service. A
database test checks the database, so it does not pay for starting clients it never uses; one
full-app test still proves the wiring.

### III. Validated Configuration

- Every setting MUST be declared in the zod schema in `src/config/env.ts`. The app refuses to
  start on a missing or malformed value.
- Code MUST read settings through `ConfigService<Env, true>`, never through `process.env`.
  The only exception is code that runs outside Nest (the TypeORM CLI, the crash reporter).
- Connection settings have no defaults in code. Local values live in `.env.example`.

Rationale: a bad configuration fails at startup, not at the first request that needs it.

### IV. Migrations Own the Schema

- Schema changes MUST go through TypeORM migrations. `synchronize` stays off.
- Entities are registered per feature module with `TypeOrmModule.forFeature` and live in
  `*.entity.ts` files.
- A migration MUST be reversible through `migration:revert` unless the plan justifies otherwise.

Rationale: every environment gets the same schema history, and each change can be reviewed.

### V. Structured, Secret-Free Logging

- Code logs with Nest's `Logger`, which writes through Pino. Data goes in fields, never in the
  message text. An error goes under the `err` key, and only there.
- Logs MUST NOT contain secrets, tokens, request bodies or query parameter values.
- A new logged header or error field MUST be added to an allowlist in
  `src/logger/serializers.ts`, and only if it can never hold a secret.
- Logs go to stdout only, as JSON lines outside a TTY.

Rationale: logs are machine-read and widely shared, so they stay parseable and safe to share.

### VI. Operable Lifecycle

- Every backing service MUST provide a readiness check marked with `@ReadinessCheck('<key>')`.
  `/live` checks nothing. `/ready` fails when any check fails.
- Clients MUST be closed in `onApplicationShutdown`, never in `onModuleDestroy`, so requests in
  flight finish during the shutdown drain.

Rationale: an orchestrator can route traffic and restart the service safely.

### VII. Pinned Supply Chain

- Dependencies published less than 3 days ago are rejected (`minimumReleaseAge`). The setting
  MUST NOT be lowered.
- GitHub Actions are pinned by full commit SHA, Docker images by version and multi-arch digest.
- TruffleHog scans the history in CI and before push. Test keys are random fakes, never keys
  copied from memory or docs.

Rationale: an unpinned or brand-new dependency is the cheapest way into the build.

## Technology & Architecture Constraints

- Runtime: Node 24+, pnpm 12 (exact version from `devEngines`), NestJS 12, TypeScript, pure ESM.
  Relative imports use a `.js` extension.
- Backing services: PostgreSQL (TypeORM), Redis (`CACHE_MANAGER`), RustFS through the S3 API,
  OpenSearch. Their infra modules are global, and feature modules inject their providers without
  importing the modules.
- `S3Service` and `OpensearchService` extend the SDK client classes. A new feature calls SDK
  methods directly and adds no wrapper API.
- A new dependency or backing service MUST be justified in the feature's `plan.md`.

## Development Workflow

- Feature work follows Spec Kit: specify, clarify if needed, plan, tasks, analyze, implement.
  Each feature's `specs/<NNN-feature-name>/` folder is committed with its code.
- `plan.md` MUST pass the Constitution Check before research and again after design. A violation
  is allowed only with an entry in the plan's Complexity Tracking table.
- Commits follow Conventional Commits. Work happens on a feature branch and merges by pull request.
- Review rounds are saved in `reports/<task-name>/` and are not committed.

## Governance

- This constitution overrides other practices. `AGENTS.md` holds the detailed runtime guidance
  and MUST stay consistent with it.
- Amendments go through `/speckit-constitution` and are committed in their own commit, with the
  Sync Impact Report removed.
- Versioning follows semantic versioning: MAJOR removes or redefines a principle, MINOR adds a
  principle or section or expands guidance, PATCH clarifies wording.
- Every plan and review checks compliance with these principles. Extra complexity MUST be justified.

**Version**: 1.1.0 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-17
