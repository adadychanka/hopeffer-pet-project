#!/bin/sh
# Runs the pinned TruffleHog image over this repository's git history.
# `pnpm run secrets:scan` and .husky/pre-push both call it, so they always use
# the same scanner. Extra arguments go to `trufflehog git` (for example
# --branch=HEAD). Dependabot cannot update this pin: bump the version and the
# digest together by hand.
set -eu

IMAGE=trufflesecurity/trufflehog:3.97.5@sha256:1cec88f18ca39e26e04e61fe9d886c9c4e5f2fc0ba4f2ed185cac0722bd8a076

# The scan only reads git objects, so the container gets as little as it needs:
# - The repo is mounted read-only.
# - It runs as the calling user, not root. HOME points at a tmpfs because the
#   image's entrypoint writes a global git config there.
# - All Linux capabilities are dropped, and privilege escalation is blocked.
# - The image's own filesystem is read-only. TruffleHog clones the repo into
#   /tmp, so /tmp is a tmpfs.
#
# The network stays on on purpose. TruffleHog sends each secret it finds to
# the provider's API to check whether it is live, and reports it as verified.
# Without network every finding is unverified. The scan still fails on it
# (the fail flag counts unverified results), but the verified label is what
# tells a real leak from a false positive when triaging.
exec docker run --rm \
  -v "$(git rev-parse --show-toplevel):/repo:ro" \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --read-only --tmpfs /tmp \
  "$IMAGE" git file:///repo --fail --no-update "$@"
