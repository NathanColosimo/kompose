import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { AuthContext } from "better-auth";

// Runs against a real Postgres. CI has none, so these skip without
// DATABASE_URL. Locally, with `bun run db:start`:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kompose bun test src
const databaseUrl = process.env.DATABASE_URL;

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const SECRET = "test-secret-that-is-at-least-32-characters";

// The two fields Better Auth's token encryption reads.
const encryptionContext = {
  options: { account: { encryptOAuthTokens: true } },
  secretConfig: SECRET,
} as unknown as AuthContext;

/**
 * A Better Auth instance with a WHOOP provider and `pluginOAuthTokens`, on the
 * real database. The tests ask it for tokens the way the app does.
 */
async function loadModules() {
  process.env.SKIP_ENV_VALIDATION ??= "1";
  const [
    { betterAuth },
    { drizzleAdapter },
    { genericOAuth },
    { decryptOAuthToken, setTokenUtil },
    { db },
    { eq },
    { pluginOAuthTokens },
    schema,
  ] = await Promise.all([
    import("better-auth"),
    import("@better-auth/drizzle-adapter/relations-v2"),
    import("better-auth/plugins"),
    import("better-auth/oauth2"),
    import("@kompose/db/legacy"),
    import("drizzle-orm"),
    import("./oauth-tokens"),
    import("@kompose/db/schema/auth"),
  ]);

  const auth = betterAuth({
    account: { encryptOAuthTokens: true },
    baseURL: "http://localhost:3000",
    database: drizzleAdapter(db, { provider: "pg", schema }),
    plugins: [
      genericOAuth({
        config: [
          {
            authorizationUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
            clientId: "test-client",
            clientSecret: "test-secret",
            providerId: "whoop",
            refreshTokenParams: { scope: "offline" },
            tokenUrl: WHOOP_TOKEN_URL,
          },
        ],
      }),
      pluginOAuthTokens(),
    ],
    secret: SECRET,
  });

  return {
    auth,
    db,
    decrypt: (token: string) => decryptOAuthToken(token, encryptionContext),
    encrypt: async (token: string) =>
      String(await setTokenUtil(token, encryptionContext)),
    eq,
    schema,
  };
}

describe.skipIf(!databaseUrl)("pluginOAuthTokens", () => {
  const userId = `test-user-${crypto.randomUUID()}`;
  const accountId = `test-account-${crypto.randomUUID()}`;

  // A stand-in for WHOOP's token endpoint. Like WHOOP, it rotates the refresh
  // token and rejects one that was already used.
  const usedRefreshTokens = new Set<string>();
  let refreshCalls = 0;
  const fetchSpy = spyOn(globalThis, "fetch");

  let modules: Awaited<ReturnType<typeof loadModules>>;

  const getAccessToken = () =>
    modules.auth.api.getAccessToken({ body: { accountId, userId } });

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
    modules = await loadModules();
    const { db, schema } = modules;

    const whoopTokenEndpoint = async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1]
    ) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== WHOOP_TOKEN_URL) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      refreshCalls += 1;
      const call = refreshCalls;
      const body = new URLSearchParams(
        input instanceof Request ? await input.text() : String(init?.body)
      );
      const refreshToken = body.get("refresh_token");
      // Hold the refresh open so concurrent callers overlap with it.
      await sleep(100);
      if (
        !refreshToken ||
        usedRefreshTokens.has(refreshToken) ||
        body.get("scope") !== "offline"
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      usedRefreshTokens.add(refreshToken);
      return Response.json({
        access_token: `refreshed-access-${call}`,
        expires_in: 3600,
        // Google sends no new refresh token; "kept-refresh" stands in for that.
        refresh_token:
          refreshToken === "kept-refresh"
            ? undefined
            : `refreshed-refresh-${call}`,
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
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    const { db, eq, schema } = modules;
    // Cascades to the account row.
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  test("reads a valid token without waiting on the row lock", async () => {
    const { db, encrypt, eq, schema } = modules;
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
        getAccessToken(),
        sleep(2000, "blocked on the row lock" as const),
      ]);
    });

    expect(result).toMatchObject({ accessToken: "stored-access" });
    expect(refreshCalls).toBe(0);
  });

  test("refreshes an expiring token once across concurrent callers", async () => {
    const { decrypt, encrypt } = modules;
    // Inside the 30 s refresh window.
    await setStoredTokens(10_000, {
      accessToken: await encrypt("stored-access"),
      refreshToken: await encrypt("stored-refresh"),
    });
    refreshCalls = 0;

    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => getAccessToken())
    );

    expect(refreshCalls).toBe(1);
    expect(new Set(tokens.map((token) => token.accessToken))).toEqual(
      new Set(["refreshed-access-1"])
    );
    const stored = await readStoredRow();
    expect(stored?.refreshToken).not.toBe("refreshed-refresh-1");
    expect(await decrypt(stored?.refreshToken ?? "")).toBe(
      "refreshed-refresh-1"
    );
    expect(stored?.scope).toBe("offline,read:cycles");
  });

  test("encrypts plaintext tokens when it refreshes them", async () => {
    const { decrypt } = modules;
    await setStoredTokens(10_000, {
      accessToken: "plain-access",
      refreshToken: "kept-refresh",
    });
    refreshCalls = 0;

    const result = await getAccessToken();

    expect(result.accessToken).toBe("refreshed-access-1");
    const stored = await readStoredRow();
    expect(stored?.accessToken).not.toBe("refreshed-access-1");
    // The provider sent no new refresh token; the old one is kept, encrypted.
    expect(stored?.refreshToken).not.toBe("kept-refresh");
    expect(await decrypt(stored?.refreshToken ?? "")).toBe("kept-refresh");
  });
});
