#!/usr/bin/env bash
# Build, sign, notarize, and publish the Apple Silicon desktop release.
#
# Policy: releases publish immediately and become GitHub's "Latest" release,
# which is what installed apps auto-update from. Run from a clean, pushed main
# after bumping "version" in apps/electron/package.json.
set -euo pipefail

ELECTRON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"
ENV_FILE="$ELECTRON_DIR/.env.release"
SIGNING_IDENTITY="Developer ID Application: Nathan Colosimo (B8R99NL6HM)"
REPO="NathanColosimo/kompose"

fail() {
  echo "Error: $*" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] ||
  fail "Releases are built on an Apple Silicon Mac."
[[ -f "$ENV_FILE" ]] ||
  fail "Missing $ENV_FILE (copy .env.release.example)."
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a
for name in APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
  [[ -n "${!name:-}" ]] || fail "$name is not set in $ENV_FILE."
done
[[ -f "$APPLE_API_KEY" ]] || fail "APPLE_API_KEY must be the path to the .p8 key."
security find-identity -v -p codesigning | grep -qF "$SIGNING_IDENTITY" ||
  fail "Signing identity not in keychain: $SIGNING_IDENTITY"
command -v gh >/dev/null || fail "GitHub CLI (gh) is required."
gh auth status >/dev/null 2>&1 || fail "Run 'gh auth login' first."

cd "$ROOT_DIR"
VERSION="$(bun -e 'console.log(require(process.argv[1]).version)' "$ELECTRON_DIR/package.json")"
TAG="v$VERSION"

# A published release reaches every user, so it must come from reviewed code.
[[ -z "$(git status --porcelain)" ]] || fail "Working tree is not clean."
[[ "$(git branch --show-current)" == "main" ]] || fail "Release from main."
git fetch --quiet origin main --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] ||
  fail "main is not in sync with origin/main."
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null ||
  gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  fail "$TAG already exists. Bump the version in apps/electron/package.json."
fi

rm -rf "$ELECTRON_DIR/release"
bun run build:desktop
(cd "$ELECTRON_DIR" && bunx electron-builder --mac --arm64 --publish never)

RELEASE_DIR="$ELECTRON_DIR/release"
APP="$RELEASE_DIR/mac-arm64/Kompose.app"
DMG="$RELEASE_DIR/Kompose-$VERSION-arm64.dmg"
ZIP="$RELEASE_DIR/Kompose-$VERSION-arm64.zip"
for artifact in "$APP" "$DMG" "$ZIP" "$ZIP.blockmap" "$RELEASE_DIR/latest-mac.yml"; do
  [[ -e "$artifact" ]] || fail "Missing build artifact: $artifact"
done
# Gatekeeper must accept the app before anyone can download it.
codesign --verify --deep --strict "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute "$APP"

git tag -a "$TAG" -m "Kompose $VERSION"
git push origin "$TAG"
gh release create "$TAG" \
  --repo "$REPO" \
  --verify-tag \
  --latest \
  --title "Kompose $VERSION" \
  --generate-notes \
  "$DMG" "$ZIP" "$ZIP.blockmap" "$RELEASE_DIR/latest-mac.yml"

echo "Published $TAG: https://github.com/$REPO/releases/tag/$TAG"
