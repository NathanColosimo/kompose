import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";

// Run with a migrated scratch DATABASE_URL. Only Redis and provider calls are faked.
describe.skipIf(!process.env.DATABASE_URL)("linked account caches", () => {
  test("unlink blocks cached reads and relink fetches fresh data", async () => {
    const values = new Map<string, string>();
    let cacheReads = 0;
    let providerReads = 0;
    mock.module("@kompose/redis", () => ({
      createSubscriber: () => {
        throw new Error("Unexpected subscription");
      },
      redis: {
        eval: () => Promise.resolve([1, 60_000]),
        get: (key: string) => {
          cacheReads += 1;
          return Promise.resolve(values.get(key) ?? null);
        },
        set: (key: string, value: string) => {
          values.set(key, value);
          return Promise.resolve("OK");
        },
      },
    }));
    mock.module("@kompose/google-cal/client", () => ({
      makeGoogleCalendarService: () => ({
        listCalendars: () =>
          Effect.sync(() => {
            providerReads += 1;
            return [{ id: "calendar", summary: "Calendar" }];
          }),
      }),
    }));
    const { db } = await import("@kompose/db/legacy");
    const { DatabaseLive } = await import("@kompose/db");
    const { account, user } = await import("@kompose/db/schema/auth");
    const { eq } = await import("drizzle-orm");
    const { call } = await import("@orpc/server");
    const { googleCalRouter } = await import("../routers/google-cal/router");
    const { GoogleCalendarCacheService } = await import(
      "../routers/google-cal/cache"
    );
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(DatabaseLive, GoogleCalendarCacheService.layer)
    );
    const userId = `cache-test-${crypto.randomUUID()}`;
    const now = new Date();
    const testUser = {
      createdAt: now,
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: "Cache test",
      updatedAt: now,
    };
    await db.insert(user).values(testUser);
    try {
      // These procedures consume only the services supplied by this runtime.
      const context = {
        "effect/context": await runtime.context(),
        user: testUser,
      } as import("../context").Context;
      const accountId = `cache-account-${crypto.randomUUID()}`;
      const insertAccount = (id: string) =>
        db.insert(account).values({
          accessToken: "test-token",
          accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
          accountId: "provider",
          createdAt: now,
          id,
          providerId: "google",
          refreshToken: "test-refresh",
          scope: "offline",
          updatedAt: now,
          userId,
        });
      const read = () =>
        call(
          googleCalRouter.calendars.list,
          { accountId: "provider" },
          { context }
        );
      await insertAccount(accountId);
      await read();
      await read();
      expect(providerReads).toBe(1);
      const readsBeforeUnlink = cacheReads;
      await db.delete(account).where(eq(account.id, accountId));
      await expect(read()).rejects.toMatchObject({
        _tag: "LinkedAccountError",
      });
      expect(cacheReads).toBe(readsBeforeUnlink);
      await insertAccount(`${accountId}-relinked`);
      await read();
      expect(providerReads).toBe(2);
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await runtime.dispose();
    }
  });
});
