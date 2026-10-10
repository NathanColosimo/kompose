import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  externalURL,
  isTrustedRenderer,
  publicResponseHeaders,
  resolveAsset,
  sanitizeSession,
} from "./protocol";

const root = await mkdtemp(join(tmpdir(), "kompose-assets-"));
await mkdir(join(root, "_next"));
await writeFile(join(root, "dashboard.html"), "dashboard");
await writeFile(join(root, "dashboard.txt"), "RSC payload");
await writeFile(join(root, "_next", "chunk.js"), "chunk");
afterAll(() => rm(root, { force: true, recursive: true }));

test("exported pages, navigation payloads, and chunks resolve without a server", async () => {
  for (const [path, file] of [
    ["/dashboard", "dashboard.html"],
    ["/dashboard.txt?_rsc=123", "dashboard.txt"],
    ["/_next/chunk.js", "_next/chunk.js"],
  ] as const) {
    // biome-ignore lint/performance/noAwaitInLoops: Small ordered test cases.
    expect(await resolveAsset(root, new URL(`kompose-app://app${path}`))).toBe(
      join(root, file)
    );
  }
});
test("asset requests cannot escape the exported directory or change hosts", async () => {
  for (const path of [
    "kompose-app://evil/dashboard",
    "kompose-app://app/%2e%2e%2fsecrets",
    "kompose-app://app/%00",
    "kompose-app://app/%zz",
    "kompose-app://app/..%5csecrets",
  ] as const) {
    // biome-ignore lint/performance/noAwaitInLoops: Small ordered test cases.
    expect(await resolveAsset(root, new URL(path))).toBeNull();
  }
});
test("only the app and an exact development origin receive native capabilities", () => {
  expect(isTrustedRenderer("kompose-app://app/dashboard")).toBe(true);
  expect(
    isTrustedRenderer(
      "https://local.kompose.dev/dashboard",
      "https://local.kompose.dev"
    )
  ).toBe(true);
  for (const value of [
    "https://local.kompose.dev.evil.test/",
    "kompose-app://evil/",
    "file:///tmp/app.html",
    "invalid",
  ]) {
    expect(isTrustedRenderer(value, "https://local.kompose.dev")).toBe(false);
  }
});
test("opening external links rejects executable schemes and embedded credentials", () => {
  expect(externalURL("https://meet.google.com/abc")).toBe(
    "https://meet.google.com/abc"
  );
  for (const value of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.com",
  ]) {
    expect(() => externalURL(value)).toThrow();
  }
});
test("session secrets and transport credential headers never enter the renderer", () => {
  expect(
    sanitizeSession({
      session: {
        id: "s1",
        ipAddress: "127.0.0.1",
        token: "secret",
        userAgent: "agent",
        userId: "u1",
      },
      user: { id: "u1" },
    })
  ).toEqual({ session: { id: "s1", userId: "u1" }, user: { id: "u1" } });
  const headers = publicResponseHeaders(
    new Headers({
      "content-encoding": "gzip",
      "content-length": "100",
      "content-type": "text/event-stream",
      "set-auth-token": "secret",
      "set-cookie": "session=secret",
    })
  );
  expect(headers.get("set-cookie")).toBeNull();
  expect(headers.get("set-auth-token")).toBeNull();
  expect(headers.get("content-length")).toBeNull();
  expect(headers.get("content-type")).toBe("text/event-stream");
});
