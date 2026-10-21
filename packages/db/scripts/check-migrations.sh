#!/usr/bin/env bash
# Fails when the Drizzle schema and the committed migrations disagree.
set -euo pipefail
cd "$(dirname "$0")/.."

# Validates the existing migrations and snapshots.
bunx drizzle-kit check

# Writes a new migration only if the schema changed without one.
bunx drizzle-kit generate

if [[ -n "$(git status --porcelain -- src/migrations)" ]]; then
  echo "The schema changed without a migration. Run 'bun run db:generate' and commit it:" >&2
  git status --short -- src/migrations >&2
  exit 1
fi
