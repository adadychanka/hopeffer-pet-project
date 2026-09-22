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

## Project setup

```bash
pnpm install
```

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
