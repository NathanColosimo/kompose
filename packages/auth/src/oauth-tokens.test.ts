import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { AuthContext } from "better-auth";
import { setTokenUtil } from "better-auth/oauth2";

// Runs against a real Postgres. CI has none, so these skip without
// DATABASE_URL. Locally, with `bun run db:start`:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kompose bun test src
const databaseUrl = process.env.DATABASE_URL;

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

// The two fields Better Auth's token encryption reads.
const authContext = {
  options: { account: { encryptOAuthTokens: true } },
  secretConfig: "test-secret-that-is-at-least-32-characters",
} as unknown as AuthContext;

const encrypt = async (token: string) =>
  String(await setTokenUtil(token, authContext));

describe.skipIf(!databaseUrl)("getPluginTokens", () => {
  const userId = `test-user-${crypto.randomUUID()}`;
  const accountId = `test-account-${crypto.randomUUID()}`;
  const request = {
    accountId,
    authContext,
    provider: "whoop",
    type: "access",
    userId,
  } as const;

  // A stand-in for WHOOP's token endpoint. Like WHOOP, it rotates the refresh
  // token and rejects one that was already used.
  const usedRefreshTokens = new Set<string>();
  let refreshCalls = 0;
  const fetchSpy = spyOn(globalThis, "fetch");

  let modules: {
    connectionTable: typeof import("@kompose/db/schema/connection")["connectionTable"];
    db: typeof import("@kompose/db/legacy")["db"];
    eq: typeof import("drizzle-orm")["eq"];
    getPluginTokens: typeof import("./oauth-tokens")["getPluginTokens"];
    schema: typeof import("@kompose/db/schema/auth");
  };

  const setStoredTokens = async (
    expiresInMs: number,
    tokens: { accessToken: string; refreshToken: string }
  ) => {
    const { db, eq, schema } = modules;
    await db
      .update(schema.account)
      .set({
        ...tokens,
        accessTokenExpiresAt: new Date(Date.now() + expiresInMs),
      })
      .where(eq(schema.account.id, accountId));
  };

  const readStoredRow = async () => {
    const { db, eq, schema } = modules;
    const [stored] = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.id, accountId));
    return stored;
  };

  beforeAll(async () => {
    process.env.SKIP_ENV_VALIDATION ??= "1";
    process.env.WHOOP_CLIENT_ID ??= "test-client";
    process.env.WHOOP_CLIENT_SECRET ??= "test-secret";

    const [{ db }, { eq }, { getPluginTokens }, schema, { connectionTable }] =
      await Promise.all([
        import("@kompose/db/legacy"),
        import("drizzle-orm"),
        import("./oauth-tokens"),
        import("@kompose/db/schema/auth"),
        import("@kompose/db/schema/connection"),
      ]);
    modules = { connectionTable, db, eq, getPluginTokens, schema };

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
      name: "OAuth token test",
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
    await db.insert(connectionTable).values({
      accountId,
      id: crypto.randomUUID(),
      pluginId: "whoop",
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
    const { db, eq, getPluginTokens, schema } = modules;
    await setStoredTokens(60 * 60 * 1000, {
      accessToken: await encrypt("stored-access"),
      refreshToken: await encrypt("stored-refresh"),
    });
    refreshCalls = 0;

    // Another transaction holds the row lock, as a refresh in flight would.
    const result = await db.transaction(async (tx) => {
      await tx
        .select({ id: schema.account.id })
        .from(schema.account)
        .where(eq(schema.account.id, accountId))
        .for("update");
      return Promise.race([
        getPluginTokens(request),
        sleep(2000, "blocked on the row lock" as const),
      ]);
    });

    expect(result).toMatchObject({ accessToken: "stored-access" });
    expect(refreshCalls).toBe(0);
  });

  test("encrypts tokens stored before encryption", async () => {
    const { getPluginTokens } = modules;
    await setStoredTokens(60 * 60 * 1000, {
      accessToken: "plain-access",
      refreshToken: "plain-refresh",
    });
    refreshCalls = 0;

    const result = await getPluginTokens(request);

    expect(result).toMatchObject({ accessToken: "plain-access" });
    expect(refreshCalls).toBe(0);
    const stored = await readStoredRow();
    expect(stored?.accessToken).not.toBe("plain-access");
    expect(stored?.refreshToken).not.toBe("plain-refresh");
  });

  test("refreshes an expiring token once across concurrent callers", async () => {
    const { getPluginTokens } = modules;
    // Inside the 30 s refresh window.
    await setStoredTokens(10_000, {
      accessToken: await encrypt("stored-access"),
      refreshToken: await encrypt("stored-refresh"),
    });
    refreshCalls = 0;

    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => getPluginTokens(request))
    );

    expect(refreshCalls).toBe(1);
    expect(new Set(tokens.map((token) => token.accessToken))).toEqual(
      new Set(["refreshed-access-1"])
    );
    const stored = await readStoredRow();
    expect(stored?.refreshToken).not.toBe("refreshed-refresh-1");
    expect(stored?.scope).toBe("offline,read:cycles");
    // The second refresh-token request reads the rotated, encrypted token.
    const refreshed = await getPluginTokens({ ...request, type: "refresh" });
    expect(refreshCalls).toBe(2);
    expect(refreshed.refreshToken).toBe("refreshed-refresh-2");
  });

  test("marks the connection needs-reauth when the grant is revoked", async () => {
    const { connectionTable, db, eq, getPluginTokens } = modules;
    usedRefreshTokens.add("revoked-refresh");
    await setStoredTokens(10_000, {
      accessToken: await encrypt("stored-access"),
      refreshToken: await encrypt("revoked-refresh"),
    });

    await expect(getPluginTokens(request)).rejects.toThrow(
      "The provider revoked access"
    );

    // Committed with the refresh's transaction, not rolled back with it.
    const [connection] = await db
      .select()
      .from(connectionTable)
      .where(eq(connectionTable.accountId, accountId));
    expect(connection?.status).toBe("needs-reauth");
  });
});
