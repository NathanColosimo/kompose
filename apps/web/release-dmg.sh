#!/usr/bin/env bash
set -euo pipefail

# Manual release helper for Apple Silicon DMG + updater artifacts.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAURI_CONFIG="$ROOT_DIR/src-tauri/tauri.conf.json"
DMG_DIR="$ROOT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
MACOS_DIR="$ROOT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"

require_single_artifact() {
  local label="$1"
  local pattern="$2"
  shopt -s nullglob
  local matches=($pattern)
  shopt -u nullglob

  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "Error: Missing $label artifact ($pattern). Run the desktop build first."
    exit 1
  fi

  if [[ ${#matches[@]} -gt 1 ]]; then
    echo "Error: Expected one $label artifact, found ${#matches[@]} for pattern:"
    echo "  $pattern"
    echo "Remove stale artifacts and retry."
    exit 1
  fi

  printf "%s\n" "${matches[0]}"
}

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required. Install and authenticate first."
  exit 1
fi

if [[ ! -f "$TAURI_CONFIG" ]]; then
  echo "Error: Tauri config not found at $TAURI_CONFIG"
  exit 1
fi

VERSION="$(
  bun -e "const fs=require('fs');const config=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(config.version);" \
    "$TAURI_CONFIG"
)"

if [[ -z "$VERSION" ]]; then
  echo "Error: Could not read version from tauri.conf.json"
  exit 1
fi

TAG="v$VERSION"
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ ! -d "$DMG_DIR" || ! -d "$MACOS_DIR" ]]; then
  echo "Error: Build artifact directories are missing. Run the desktop build first."
  exit 1
fi

DMG_FILE="$(require_single_artifact "DMG" "$DMG_DIR/*.dmg")"
TAR_FILE="$(require_single_artifact "macOS updater archive" "$MACOS_DIR/*.app.tar.gz")"
TAR_SIG_FILE="$(require_single_artifact "macOS updater signature" "$MACOS_DIR/*.app.tar.gz.sig")"

TAR_FILENAME="$(basename "$TAR_FILE")"
TAR_SIG_CONTENTS="$(<"$TAR_SIG_FILE")"
LATEST_JSON_PATH="$MACOS_DIR/latest.json"
TAR_URL="https://github.com/nathancolosimo/kompose/releases/download/$TAG/$TAR_FILENAME"

cat >"$LATEST_JSON_PATH" <<JSON
{
  "version": "$VERSION",
  "notes": "Manual release build.",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$TAR_SIG_CONTENTS",
      "url": "$TAR_URL"
    }
  }
}
JSON

gh release create "$TAG" \
  "$DMG_FILE" \
  "$TAR_FILE" \
  "$TAR_SIG_FILE" \
  "$LATEST_JSON_PATH" \
  --title "Kompose $VERSION" \
  --notes "Manual DMG release."

echo "Release $TAG created with DMG + updater artifacts."
