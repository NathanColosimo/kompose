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
LEGAL_COMPONENTS_DIR="src/components/legal"

restore_removed_sources() {
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

  if [ -d "$TEMP_DIR/legal-components" ]; then
    rm -rf "$LEGAL_COMPONENTS_DIR"
    mv "$TEMP_DIR/legal-components" "$LEGAL_COMPONENTS_DIR"
  fi
}

cleanup() {
  exit_code=$?
  restore_removed_sources

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

  if [ -d "$LEGAL_COMPONENTS_DIR" ]; then
    mv "$LEGAL_COMPONENTS_DIR" "$TEMP_DIR/legal-components"
  fi
fi

rm -rf .next out
TAURI_BUILD=1 bun ./node_modules/next/dist/bin/next build

# The desktop build intentionally generates route types while API/docs/legal
# routes are absent. Restore the source tree, then refresh typed routes so
# follow-up `tsgo --noEmit` runs see the normal app route set again.
restore_removed_sources
TAURI_BUILD=1 bun ./node_modules/next/dist/bin/next typegen
