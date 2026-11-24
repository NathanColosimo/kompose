import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";

// Run with a migrated scratch DATABASE_URL. Redis and the WHOOP API are faked.
describe.skipIf(!process.env.DATABASE_URL)("WHOOP data changed", () => {
  test("drops only the days the changed record can be on, and tells the owner's clients", async () => {
    const cached = new Map<string, string>();
    const published: { channel: string; message: string }[] = [];
    mock.module("@kompose/redis", () => ({
      createSubscriber: () => {
        throw new Error("Unexpected subscription");
      },
      redis: {
        del: (...keys: string[]) => {
          for (const key of keys) {
            cached.delete(key);
          }
          return Promise.resolve(keys.length);
        },
        publish: (channel: string, message: string) => {
          published.push({ channel, message });
          return Promise.resolve(1);
        },
        scan: (_cursor: string, _match: string, pattern: string) =>
          Promise.resolve([
            "0",
            [...cached.keys()].filter((key) =>
              key.startsWith(pattern.slice(0, -1))
            ),
          ]),
      },
    }));
    // A workout on the afternoon of 5 November, New York time, and a sleep
    // from that night into the 6th.
    const lookedUp: string[] = [];
    mock.module("@kompose/whoop/client", () => ({
      createWhoopClient: () => ({
        getSleep: (id: string) => {
          lookedUp.push(`sleep ${id}`);
          return Effect.succeed({
            end: "2026-11-06T12:00:00.000Z",
            start: "2026-11-06T04:00:00.000Z",
            timezone_offset: "-05:00",
          });
        },
        getWorkout: (id: string) => {
          lookedUp.push(`workout ${id}`);
          return id === "missing"
            ? Effect.fail(new Error("404"))
            : Effect.succeed({
                end: "2026-11-05T21:00:00.000Z",
                start: "2026-11-05T20:00:00.000Z",
                timezone_offset: "-05:00",
              });
        },
      }),
    }));
    const { db } = await import("@kompose/db/legacy");
    const { DatabaseLive } = await import("@kompose/db");
    const { account, user } = await import("@kompose/db/schema/auth");
    const { eq } = await import("drizzle-orm");
    const { WhoopService } = await import("./service");
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(DatabaseLive, WhoopService.layer)
    );

    const userId = `whoop-webhook-${crypto.randomUUID()}`;
    const accountId = `whoop-account-${crypto.randomUUID()}`;
    // WHOOP user IDs are integers; a random one keeps runs apart.
    const whoopUserId = String(Math.floor(Math.random() * 1e9));
    const now = new Date();
    await db.insert(user).values({
      createdAt: now,
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: "WHOOP webhook test",
      updatedAt: now,
    });
    await db.insert(account).values({
      accessToken: "test-token",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      accountId: whoopUserId,
      createdAt: now,
      id: accountId,
      providerId: "whoop",
      refreshToken: "test-refresh",
      scope: "offline read:cycles",
      updatedAt: now,
      userId,
    });
    const otherAccountDay = "whoop:day:other-user:other-account:2026-11-05";
    /** Caches 1 to 7 November for the account; returns the days still cached. */
    const cachedDaysAfter = async (
      change: { id: string; type: string },
      forWhoopUser = whoopUserId
    ) => {
      cached.clear();
      cached.set(otherAccountDay, "{}");
      for (let day = 1; day <= 7; day += 1) {
        cached.set(`whoop:day:${userId}:${accountId}:2026-11-0${day}`, "{}");
      }
      await runtime.runPromise(
        WhoopService.use((whoop) =>
          whoop.dataChanged({ ...change, whoopUserId: forWhoopUser })
        )
      );
      expect(cached.has(otherAccountDay)).toBe(true);
      return [...cached.keys()]
        .filter((key) => key !== otherAccountDay)
        .map((key) => Number(key.slice(-2)));
    };

    try {
      // A workout on the 5th: the 4th and the 5th.
      expect(
        await cachedDaysAfter({ id: "w1", type: "workout.updated" })
      ).toEqual([1, 2, 3, 6, 7]);
      expect(published).toEqual([
        {
          channel: `user:${userId}`,
          message: JSON.stringify({ payload: {}, type: "whoop" }),
        },
      ]);

      // A sleep from the night of the 5th to the morning of the 6th, named
      // by a sleep event or by its recovery: the 4th to the 6th.
      expect(
        await cachedDaysAfter({ id: "s1", type: "sleep.updated" })
      ).toEqual([1, 2, 3, 7]);
      expect(
        await cachedDaysAfter({ id: "s1", type: "recovery.updated" })
      ).toEqual([1, 2, 3, 7]);
      expect(lookedUp).toEqual(["workout w1", "sleep s1", "sleep s1"]);

      // A deleted record can't be looked up, and a lookup can fail: every day.
      expect(
        await cachedDaysAfter({ id: "w1", type: "workout.deleted" })
      ).toEqual([]);
      expect(
        await cachedDaysAfter({ id: "missing", type: "workout.updated" })
      ).toEqual([]);
      expect(published).toHaveLength(5);

      // A WHOOP user nobody has linked changes nothing.
      expect(
        await cachedDaysAfter(
          { id: "w1", type: "workout.updated" },
          `${whoopUserId}0`
        )
      ).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(published).toHaveLength(5);
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await runtime.dispose();
    }
  });
});
