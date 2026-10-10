#!/usr/bin/env bash

set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# A sibling app preserves ../../packages imports and the Next.js workspace root.
# Copy sources rather than linking them: Next also writes generated types/config.
BUILD_DIR="$(mktemp -d "$WEB_DIR/../.kompose-desktop-XXXXXX")"
CACHE_DIR="$WEB_DIR/.cache/desktop-next"

cleanup() {
  exit_code=$?
  set +e
  if [ -d "$BUILD_DIR/.next/cache" ]; then
    mkdir -p "$CACHE_DIR"
    rsync -a --delete "$BUILD_DIR/.next/cache/" "$CACHE_DIR/"
  fi
  rm -rf "$BUILD_DIR"
  exit "$exit_code"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Web builds and next dev continue using the original source tree and .next.
rsync -a \
  --exclude='/node_modules/' \
  --exclude='/.next/' \
  --exclude='/out/' \
  --exclude='/.cache/' \
  --exclude='/.turbo/' \
  --exclude='/.source/' \
  --exclude='/.vercel/' \
  --exclude='/build/' \
  --exclude='/dist/' \
  --exclude='/*.tsbuildinfo' \
  --exclude='/src/app/api/' \
  --exclude='/src/app/docs/' \
  --exclude='/src/lib/source.ts' \
  "$WEB_DIR/" "$BUILD_DIR/"
ln -s "$WEB_DIR/node_modules" "$BUILD_DIR/node_modules"

# Production desktop builds open hosted legal pages in the system browser.
if [ "${NEXT_PUBLIC_DEPLOYMENT_ENV:-}" = "production" ]; then
  rm -rf "$BUILD_DIR/src/app/privacy" "$BUILD_DIR/src/app/terms" \
    "$BUILD_DIR/src/components/legal"
fi

if [ -d "$CACHE_DIR" ]; then
  mkdir -p "$BUILD_DIR/.next/cache"
  rsync -a "$CACHE_DIR/" "$BUILD_DIR/.next/cache/"
fi

cd "$BUILD_DIR"
DESKTOP_BUILD=1 bun ./node_modules/next/dist/bin/next build

# Keep the last successful export if compilation fails. Packaging still reads
# apps/web/out; no web source, route types, config, or .next output is replaced.
test -d "$BUILD_DIR/out"
rm -rf "$WEB_DIR/out"
mv "$BUILD_DIR/out" "$WEB_DIR/out"
