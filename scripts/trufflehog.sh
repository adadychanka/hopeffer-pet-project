#!/bin/sh
# Runs the pinned TruffleHog image over this repository's git history.
# `pnpm run secrets:scan` and .husky/pre-push both call it, so they always use
# the same scanner. Extra arguments go to `trufflehog git` (for example
# --branch=HEAD). Dependabot cannot update this pin: bump the version and the
# digest together by hand.
set -eu

IMAGE=trufflesecurity/trufflehog:3.97.5@sha256:1cec88f18ca39e26e04e61fe9d886c9c4e5f2fc0ba4f2ed185cac0722bd8a076

# Read-only mount: the scan reads git objects and writes nothing to the repo.
exec docker run --rm -v "$(git rev-parse --show-toplevel):/repo:ro" "$IMAGE" \
  git file:///repo --fail --no-update "$@"
