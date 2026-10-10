import { expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "bun";

function buildFixture(production: boolean, fail: boolean) {
  const root = mkdtempSync(join(tmpdir(), "kompose-desktop-test-"));
  const web = join(root, "apps/web");
  const originals = [
    "src/app/api/auth/route.ts",
    "src/app/docs/page.tsx",
    "src/lib/source.ts",
    "src/app/privacy/page.tsx",
    "src/app/terms/page.tsx",
    "src/components/legal/shell.tsx",
    ".next/server/web-output",
    ".next/dev/types/validator.ts",
    ".next/cache/web-cache",
    "tsconfig.json",
    "next-env.d.ts",
  ];
  const write = (path: string, content: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  };

  try {
    for (const path of originals) {
      write(join(web, path), `original ${path}`);
    }
    write(join(web, "out/previous.html"), "last successful export");
    write(join(web, ".cache/desktop-next/desktop-cache"), "desktop cache");
    mkdirSync(join(web, "scripts"));
    mkdirSync(join(web, "node_modules"));
    copyFileSync(
      new URL("./build-desktop.sh", import.meta.url),
      join(web, "scripts/build-desktop.sh")
    );

    // Stand in for Next so we can assert the filesystem boundary even on failure.
    const runner = join(root, "bin/bun");
    write(
      runner,
      `#!/usr/bin/env bash
set -euo pipefail
test "$PWD" != "$ORIGINAL_WEB"
test "$DESKTOP_BUILD" = 1
test "$2" = build
test ! -e src/app/api
test ! -e src/app/docs
test ! -e src/lib/source.ts
test ! -e .next/server/web-output
test ! -e .next/dev/types/validator.ts
test -f .next/cache/desktop-cache
test -L node_modules
if [ "$NEXT_PUBLIC_DEPLOYMENT_ENV" = production ]; then
  test ! -e src/app/privacy
  test ! -e src/app/terms
  test ! -e src/components/legal
else
  test -f src/app/privacy/page.tsx
  test -f src/app/terms/page.tsx
  test -f src/components/legal/shell.tsx
fi
echo generated > tsconfig.json
echo generated > next-env.d.ts
mkdir -p .next/types
echo generated > .next/types/validator.ts
if [ "$FAIL_BUILD" = 1 ]; then exit 42; fi
mkdir -p out
echo exported > out/dashboard.html
`
    );
    chmodSync(runner, 0o755);
    const result = spawnSync(["bash", "scripts/build-desktop.sh"], {
      cwd: web,
      env: {
        ...process.env,
        FAIL_BUILD: fail ? "1" : "0",
        NEXT_PUBLIC_DEPLOYMENT_ENV: production ? "production" : "development",
        ORIGINAL_WEB: web,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
      },
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(fail ? 42 : 0);
    for (const path of originals) {
      expect(readFileSync(join(web, path), "utf8")).toBe(`original ${path}`);
    }
    expect(readdirSync(join(root, "apps"))).toEqual(["web"]);
    expect(existsSync(join(web, "out/previous.html"))).toBe(fail);
    expect(existsSync(join(web, "out/dashboard.html"))).toBe(!fail);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

test("desktop export leaves web sources, generated types, and build output intact", () => {
  buildFixture(false, false);
});

test("production export excludes legal pages only in its isolated copy", () => {
  buildFixture(true, false);
});

test("failed desktop builds preserve the last export and remove their temporary copy", () => {
  buildFixture(false, true);
});
