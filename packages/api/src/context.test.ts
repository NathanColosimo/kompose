import { afterAll, expect, mock, setSystemTime, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { NextRequest } from "next/server";

const BASE_URL = "http://localhost:3000";
const DAY_MS = 24 * 60 * 60 * 1000;

const auth = betterAuth({
  baseURL: BASE_URL,
  database: memoryAdapter({
    account: [],
    session: [],
    user: [],
    verification: [],
  }),
  emailAndPassword: { enabled: true },
  logger: { level: "error" },
  secret: "test-secret-that-is-at-least-32-chars",
});
mock.module("@kompose/auth", () => ({ auth }));
mock.module("./runtime", () => ({
  appRuntime: { context: () => Promise.resolve({}) },
}));
const { createContext } = await import("./context");

afterAll(() => {
  setSystemTime();
});

// The mobile app saves cookies only from Better Auth responses. If an RPC
// call extended the session first, /get-session would send no cookie and the
// app's saved cookie would expire on its old date.
test("an RPC call leaves the session refresh to /get-session", async () => {
  const signUp = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email: "user@example.com",
        name: "User",
        password: "password1234",
      }),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    })
  );
  const cookie = signUp.headers.get("set-cookie")?.split(";")[0] ?? "";

  // Past the one-day updateAge, so the next session read extends it.
  setSystemTime(new Date(Date.now() + 2 * DAY_MS));
  const context = await createContext(
    new Request(`${BASE_URL}/api/rpc/tasks/list`, {
      headers: { cookie },
    }) as unknown as NextRequest
  );
  expect(context.user?.email).toBe("user@example.com");

  const getSession = await auth.handler(
    new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie } })
  );
  expect(getSession.headers.get("set-cookie")).toContain("session_token=");
});
