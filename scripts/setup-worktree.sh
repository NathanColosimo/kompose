#!/bin/sh
# Prepare a new git worktree for work: copy the git-ignored .env files from the
# main checkout, then install dependencies. T3 Code runs this when it creates a
# worktree (see t3.json); it also works run by hand from any worktree.
set -eu

main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
here=$(git rev-parse --show-toplevel)

if [ "$main" != "$here" ]; then
    # Agent tools keep their own worktrees under .claude/worktrees in the main
    # checkout. Their .env copies are not this project's config.
    (cd "$main" && find . \( -name node_modules -o -name .git -o -path ./.claude/worktrees \) -prune \
        -o -name '.env*' ! -name '*.example' -type f -print) |
        while read -r file; do
            [ -e "$here/$file" ] && continue
            mkdir -p "$here/$(dirname "$file")"
            cp "$main/$file" "$here/$file"
        done
fi

cd "$here"
bun install
