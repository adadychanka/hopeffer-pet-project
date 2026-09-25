#!/bin/sh
# Checks the message of every commit on this branch that origin/main does not
# have yet, so commits made with --no-verify or in the GitHub web UI are caught
# too. `pnpm run ci` runs it locally and in CI.
set -eu

# On a push to main (and on main locally) the range is empty. commitlint 21
# rejects --from and --to pointing to the same commit with exit code 9, so skip
# it when there is nothing to check. If origin/main is missing, rev-list fails,
# the count is empty, and commitlint runs and fails loudly: run `git fetch`.
if [ "$(git rev-list --count origin/main..HEAD 2>/dev/null)" = 0 ]; then
  exit 0
fi

exec commitlint --from origin/main --to HEAD
