import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";

// Runs against a real Postgres. CI has none, so these skip without
// DATABASE_URL. Locally, with `bun run db:start`:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kompose bun test src
const databaseUrl = process.env.DATABASE_URL;

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

describe.skipIf(!databaseUrl)("getWhoopTokens", () => {
  const userId = `test-user-${crypto.randomUUID()}`;
  const accountId = `test-account-${crypto.randomUUID()}`;
  const request = { accountId, type: "accessToken", userId } as const;

  // A stand-in for WHOOP's token endpoint. Like WHOOP, it rotates the refresh
  // token and rejects one that was already used.
  const usedRefreshTokens = new Set<string>();
  let refreshCalls = 0;
  const fetchSpy = spyOn(globalThis, "fetch");

  let modules: {
    db: typeof import("@kompose/db/legacy")["db"];
    eq: typeof import("drizzle-orm")["eq"];
    getWhoopTokens: typeof import("./whoop")["getWhoopTokens"];
    schema: typeof import("@kompose/db/schema/auth");
  };

  const setStoredToken = async (expiresInMs: number) => {
    const { db, eq, schema } = modules;
    await db
      .update(schema.account)
      .set({
        accessToken: "stored-access",
        accessTokenExpiresAt: new Date(Date.now() + expiresInMs),
        refreshToken: "stored-refresh",
      })
      .where(eq(schema.account.id, accountId));
  };

  beforeAll(async () => {
    process.env.SKIP_ENV_VALIDATION ??= "1";
    process.env.WHOOP_CLIENT_ID ??= "test-client";
    process.env.WHOOP_CLIENT_SECRET ??= "test-secret";

    const [{ db }, { eq }, { getWhoopTokens }, schema] = await Promise.all([
      import("@kompose/db/legacy"),
      import("drizzle-orm"),
      import("./whoop"),
      import("@kompose/db/schema/auth"),
    ]);
    modules = { db, eq, getWhoopTokens, schema };

    const whoopTokenEndpoint = async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      if (String(input) !== WHOOP_TOKEN_URL) {
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }
      refreshCalls += 1;
      const call = refreshCalls;
      const refreshToken = new URLSearchParams(String(init?.body)).get(
        "refresh_token"
      );
      // Hold the refresh open so concurrent callers overlap with it.
      await sleep(100);
      if (!refreshToken || usedRefreshTokens.has(refreshToken)) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      usedRefreshTokens.add(refreshToken);
      return Response.json({
        access_token: `refreshed-access-${call}`,
        expires_in: 3600,
        refresh_token: `refreshed-refresh-${call}`,
        scope: "offline read:cycles",
        token_type: "bearer",
      });
    };
    fetchSpy.mockImplementation(
      Object.assign(whoopTokenEndpoint, { preconnect: fetch.preconnect })
    );

    const now = new Date();
    await db.insert(schema.user).values({
      createdAt: now,
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: "WHOOP token test",
      updatedAt: now,
    });
    await db.insert(schema.account).values({
      accountId: `whoop-${userId}`,
      createdAt: now,
      id: accountId,
      providerId: "whoop",
      scope: "offline,read:cycles",
      updatedAt: now,
      userId,
    });
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    const { db, eq, schema } = modules;
    // Cascades to the account row.
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  test("reads a valid token without waiting on the row lock", async () => {
    const { db, eq, getWhoopTokens, schema } = modules;
    await setStoredToken(60 * 60 * 1000);
    refreshCalls = 0;

    // Another transaction holds the row lock, as a refresh in flight would.
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: schema.account.id })
        .from(schema.account)
        .where(eq(schema.account.id, accountId))
        .for("update");
      return Promise.race([
        getWhoopTokens(request),
        sleep(2000, "blocked on the row lock" as const),
      ]);
    });

    expect(result).toMatchObject({ accessToken: "stored-access" });
    expect(refreshCalls).toBe(0);
  });

  test("refreshes an expiring token once across concurrent callers", async () => {
    const { db, eq, getWhoopTokens, schema } = modules;
    // Inside the 30 s refresh window.
    await setStoredToken(10_000);
    refreshCalls = 0;

    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => getWhoopTokens(request))
    );

    expect(refreshCalls).toBe(1);
    expect(new Set(tokens.map((token) => token.accessToken))).toEqual(
      new Set(["refreshed-access-1"])
    );
    const [stored] = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.id, accountId));
    expect(stored?.refreshToken).toBe("refreshed-refresh-1");
    expect(stored?.scope).toBe("offline,read:cycles");
  });
});
