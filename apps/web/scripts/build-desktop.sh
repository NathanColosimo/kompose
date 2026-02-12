#!/usr/bin/env bash

set -euo pipefail

# Build helper for Tauri desktop export:
# - Temporarily remove API + docs routes from Next app directory.
# - Always restore original files after build (success, failure, or interruption).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEMP_DIR="$(mktemp -d)"
API_DIR="src/app/api"
DOCS_DIR="src/app/docs"

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

rm -rf .next out
TAURI_BUILD=1 bun --bun next build
