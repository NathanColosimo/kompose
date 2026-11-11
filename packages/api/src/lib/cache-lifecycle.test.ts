import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";

// Run with a migrated scratch DATABASE_URL. Only Redis and provider calls are faked.
describe.skipIf(!process.env.DATABASE_URL)("linked account caches", () => {
  test("unlink blocks cached reads and relink fetches fresh data for Google and WHOOP", async () => {
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
    mock.module("@kompose/whoop/client", () => ({
      createWhoopClient: () => {
        providerReads += 1;
        return {
          listCycles: () => Effect.succeed([]),
          listRecoveries: () => Effect.succeed([]),
          listSleeps: () => Effect.succeed([]),
          listWorkouts: () => Effect.succeed([]),
        };
      },
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
    const { WhoopCacheService } = await import("../routers/whoop/cache");
    const { WhoopService } = await import("../routers/whoop/service");
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        DatabaseLive,
        GoogleCalendarCacheService.layer,
        Layer.effect(WhoopService, WhoopService.make).pipe(
          Layer.provide(WhoopCacheService.layer)
        )
      )
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
      const checkProvider = async (providerId: "google" | "whoop") => {
        const accountId = `cache-account-${crypto.randomUUID()}`;
        const insertAccount = (id: string) =>
          db.insert(account).values({
            accessToken: "test-token",
            accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
            accountId: "provider",
            createdAt: now,
            id,
            providerId,
            refreshToken: "test-refresh",
            scope: "offline read:cycles",
            updatedAt: now,
            userId,
          });
        const read =
          providerId === "google"
            ? () =>
                call(
                  googleCalRouter.calendars.list,
                  { accountId: "provider" },
                  { context }
                )
            : () =>
                runtime.runPromise(
                  WhoopService.use((service) =>
                    service.listDaySummaries({
                      accountId: "provider",
                      endDate: "2026-11-05",
                      startDate: "2026-11-05",
                      timeZone: "UTC",
                      userId,
                    })
                  )
                );
        await insertAccount(accountId);
        const fetchedBefore = providerReads;
        await read();
        await read();
        expect(providerReads - fetchedBefore).toBe(1);
        const readsBeforeUnlink = cacheReads;
        await db.delete(account).where(eq(account.id, accountId));
        await expect(read()).rejects.toMatchObject({
          _tag: "LinkedAccountError",
        });
        expect(cacheReads).toBe(readsBeforeUnlink);
        await insertAccount(`${accountId}-relinked`);
        await read();
        expect(providerReads - fetchedBefore).toBe(2);
      };
      await checkProvider("google");
      await checkProvider("whoop");
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await runtime.dispose();
    }
  });
});
