#!/usr/bin/env bash

set -euo pipefail

# Build helper for Tauri desktop export:
# - Temporarily remove routes that should not be embedded in the desktop bundle.
# - Always restore original files after build (success, failure, or interruption).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEMP_DIR="$(mktemp -d)"
API_DIR="src/app/api"
DOCS_DIR="src/app/docs"
PRIVACY_DIR="src/app/privacy"
TERMS_DIR="src/app/terms"

cleanup() {
  exit_code=$?
  set +e

  if [ -d "$TEMP_DIR/api" ]; then
    rm -rf "$API_DIR"
    mv "$TEMP_DIR/api" "$API_DIR"
  fi

  if [ -d "$TEMP_DIR/docs" ]; then
    rm -rf "$DOCS_DIR"
    mv "$TEMP_DIR/docs" "$DOCS_DIR"
  fi

  if [ -d "$TEMP_DIR/privacy" ]; then
    rm -rf "$PRIVACY_DIR"
    mv "$TEMP_DIR/privacy" "$PRIVACY_DIR"
  fi

  if [ -d "$TEMP_DIR/terms" ]; then
    rm -rf "$TERMS_DIR"
    mv "$TEMP_DIR/terms" "$TERMS_DIR"
  fi

  rm -rf "$TEMP_DIR"
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

if [ -d "$API_DIR" ]; then
  mv "$API_DIR" "$TEMP_DIR/api"
fi

if [ -d "$DOCS_DIR" ]; then
  mv "$DOCS_DIR" "$TEMP_DIR/docs"
fi

# Production desktop builds open the hosted legal pages in the system browser,
# so the embedded Tauri bundle does not need to include those routes.
if [ "${NEXT_PUBLIC_DEPLOYMENT_ENV:-}" = "production" ]; then
  if [ -d "$PRIVACY_DIR" ]; then
    mv "$PRIVACY_DIR" "$TEMP_DIR/privacy"
  fi

  if [ -d "$TERMS_DIR" ]; then
    mv "$TERMS_DIR" "$TEMP_DIR/terms"
  fi
fi

rm -rf .next out
TAURI_BUILD=1 bun ./node_modules/next/dist/bin/next build
