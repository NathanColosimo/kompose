import { beforeEach, expect, mock, test } from "bun:test";
import { ELECTRON_AUTH_SCHEME } from "@kompose/desktop";

// The config in ./index, set up as production runs it, answering requests in
// this process. Better Auth skips its origin checks when it loads with
// NODE_ENV=test. `bun test --isolate` gives each file its own environment.
const WEB_URL = "https://kompose.test";
Object.assign(process.env, {
  APPLE_CLIENT_ID: "test-apple-client",
  APPLE_CLIENT_SECRET: "test-apple-secret",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  GOOGLE_CLIENT_ID: "test-google-client",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
  NEXT_PUBLIC_DEPLOYMENT_ENV: "production",
  NEXT_PUBLIC_WEB_URL: WEB_URL,
  NODE_ENV: "production",
  SKIP_ENV_VALIDATION: "1",
});

// CI has no Redis or Postgres, so both are in memory.
const redis = new Map<string, string>();
mock.module("./redis-storage", () => ({
  redisSecondaryStorage: {
    delete: (key: string) => {
      redis.delete(key);
    },
    get: (key: string) => redis.get(key) ?? null,
    increment: (key: string) => {
      const count = Number(redis.get(key) ?? 0) + 1;
      redis.set(key, String(count));
      return count;
    },
    set: (key: string, value: string) => {
      redis.set(key, value);
    },
  },
}));
mock.module("@kompose/db/legacy", () => ({ db: {} }));
const { memoryAdapter } = await import("better-auth/adapters/memory");
mock.module("@better-auth/drizzle-adapter/relations-v2", () => ({
  drizzleAdapter: () => memoryAdapter({ oauthResource: [], verification: [] }),
}));
const { auth } = await import("./index");

// Better Auth allows three sign-in requests per ten seconds.
beforeEach(() => redis.clear());

const post = (path: string, body: Record<string, string>) =>
  auth.handler(
    new Request(`${WEB_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: WEB_URL },
      method: "POST",
    })
  );

const signInStatuses = (callbackURLs: string[]) =>
  Promise.all(
    callbackURLs.map(async (callbackURL) => {
      const response = await post("/sign-in/social", {
        callbackURL,
        provider: "google",
      });
      return response.status;
    })
  );

test("a client can't fetch a linked account's provider token over HTTP", async () => {
  const response = await post("/get-access-token", { providerId: "google" });

  expect(response.status).toBe(404);
});

test("a sign-in can return to the web, mobile and desktop apps", async () => {
  const statuses = await signInStatuses([
    `${WEB_URL}/dashboard`,
    "kompose://settings",
    `${ELECTRON_AUTH_SCHEME}:/`,
  ]);

  expect(statuses).toEqual([200, 200, 200]);
});

test("a production sign-in can't return to a development origin", async () => {
  const statuses = await signInStatuses([
    "exp://192.168.1.5:8081/--/settings",
    "http://localhost:3000/dashboard",
  ]);

  expect(statuses).toEqual([403, 403]);
});
