#!/usr/bin/env bash

set -euo pipefail

# Build the unsigned desktop-dev flavor with a temporary light icon set.
# The production icons are always restored after the build finishes.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ICONS_DIR="src-tauri/icons"
DEV_ICON_SOURCE="$ICONS_DIR/kompose-icon-light.png"
DEV_ENV_FILE=".tauri.dev.env"
BACKUP_ROOT="$(mktemp -d)"
BACKUP_ICONS_DIR="$BACKUP_ROOT/icons"

restore_icons() {
  local exit_code=$?
  set +e

  if [ -d "$BACKUP_ICONS_DIR" ]; then
    rm -rf "$ICONS_DIR"
    cp -R "$BACKUP_ICONS_DIR" "$ICONS_DIR"
  fi

  rm -rf "$BACKUP_ROOT"
  exit "$exit_code"
}

trap restore_icons EXIT INT TERM

if [ ! -d "$ICONS_DIR" ]; then
  echo "Error: Expected icons directory at $ICONS_DIR"
  exit 1
fi

if [ ! -f "$DEV_ICON_SOURCE" ]; then
  echo "Error: Missing desktop-dev source icon at $DEV_ICON_SOURCE"
  exit 1
fi

if [ ! -f "$DEV_ENV_FILE" ]; then
  echo "Error: Missing desktop-dev env file at $DEV_ENV_FILE"
  echo "Create it from .tauri.dev.env.example before running this build."
  exit 1
fi

# Snapshot the current generated icons so the production branding stays intact
# after the dev build completes.
cp -R "$ICONS_DIR" "$BACKUP_ICONS_DIR"

# Generate a temporary light icon set in the standard Tauri icon location so
# the dev flavor can reuse the normal bundle icon paths.
bunx tauri icon "$DEV_ICON_SOURCE" --output "$ICONS_DIR"

# Load the desktop-dev frontend env from a dedicated file so the command itself
# stays clean and the prod desktop env can remain separate.
set -a
. "./$DEV_ENV_FILE"
set +a

bunx tauri build \
  --config src-tauri/tauri.desktop-dev.conf.json \
  --no-sign \
  --bundles app,dmg \
  --target aarch64-apple-darwin
