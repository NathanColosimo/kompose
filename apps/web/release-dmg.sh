#!/usr/bin/env bash
set -euo pipefail

# Manual release helper for Apple Silicon DMG + updater artifacts.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAURI_CONFIG="$ROOT_DIR/src-tauri/tauri.conf.json"
DMG_DIR="$ROOT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
MACOS_DIR="$ROOT_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required. Install and authenticate first."
  exit 1
fi

if [[ ! -f "$TAURI_CONFIG" ]]; then
  echo "Error: Tauri config not found at $TAURI_CONFIG"
  exit 1
fi

VERSION="$(
  node -e "const fs=require('fs');const path=require('path');const config=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(config.version);" \
    "$TAURI_CONFIG"
)"

if [[ -z "$VERSION" ]]; then
  echo "Error: Could not read version from tauri.conf.json"
  exit 1
fi

TAG="v$VERSION"
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

DMG_FILE="$(ls "$DMG_DIR"/*.dmg | head -n 1)"
TAR_FILE="$(ls "$MACOS_DIR"/*.app.tar.gz | head -n 1)"
TAR_SIG_FILE="$(ls "$MACOS_DIR"/*.app.tar.gz.sig | head -n 1)"

if [[ ! -f "$DMG_FILE" || ! -f "$TAR_FILE" || ! -f "$TAR_SIG_FILE" ]]; then
  echo "Error: Missing build artifacts. Run the build before releasing."
  exit 1
fi

TAR_FILENAME="$(basename "$TAR_FILE")"
TAR_SIG_CONTENTS="$(cat "$TAR_SIG_FILE")"
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
