#!/bin/sh
# Installs the toolchain this project needs into a Docker Sandbox (Ubuntu).
# The stock sandbox image ships Node 22 and no pnpm; the project needs Node 24
# and pnpm 12. Safe to run again: it skips what is already installed.
#
# Node comes from the official nodejs.org tarball, checked against the
# published SHA-256 sums. It is the .tar.gz build, because the image has no xz.
# Any pnpm 12 works: devEngines.packageManager (onFail: download) switches it
# to the exact version recorded in pnpm-lock.yaml.
set -eu

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 24 ]; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;;
  esac
  base=https://nodejs.org/dist/latest-v24.x
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  tarball=$(grep -o "node-v24[^ ]*-linux-$arch\.tar\.gz" "$tmp/SHASUMS256.txt")
  curl -fsSL "$base/$tarball" -o "$tmp/$tarball"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  sudo tar -xzf "$tmp/$tarball" -C /usr/local --strip-components=1
  hash -r
fi
echo "node $(node --version)"

if ! pnpm --version 2>/dev/null | grep -q '^12\.'; then
  sudo env "PATH=$PATH" npm install --global pnpm@12
fi
echo "pnpm $(cd / && pnpm --version)"
