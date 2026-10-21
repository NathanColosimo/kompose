#!/usr/bin/env bash
# Prints a hash of everything that ends up in the desktop binary: the built
# main/preload bundles, packaging config and assets, and the Electron runtime
# versions. The UI is the hosted web app, so anything else changing does not
# need a new desktop release.
#
# Requires `bun run build:desktop` to have produced apps/electron/dist.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ELECTRON_DIR="$ROOT_DIR/apps/electron"
cd "$ELECTRON_DIR"

[[ -d dist ]] || {
  echo "apps/electron/dist is missing; run bun run build:desktop first." >&2
  exit 1
}

{
  find dist build -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256
  shasum -a 256 electron-builder.yml
  for pkg in electron electron-builder electron-updater; do
    echo "$pkg@$(bun -e "console.log(require('$pkg/package.json').version)")"
  done
} | shasum -a 256 | cut -c1-16
