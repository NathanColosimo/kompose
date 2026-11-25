import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Temporal } from "temporal-polyfill";

// Run with a migrated scratch DATABASE_URL. Redis and the WHOOP API are faked.
describe.skipIf(!process.env.DATABASE_URL)("WHOOP sync", () => {
  test("stores WHOOP days, answers reads from them, and follows WHOOP's changes", async () => {
    // Yesterday in UTC, with every record in UTC, so the day is the same
    // wherever and whenever the test runs.
    const today = Temporal.Now.plainDateISO("UTC");
    const day = today.subtract({ days: 1 }).toString();
    const dayBefore = today.subtract({ days: 2 }).toString();
    const record = {
      timezone_offset: "+00:00",
      updated_at: `${day}T12:00:00Z`,
    };
    const sleepId = crypto.randomUUID();
    const napId = crypto.randomUUID();
    const workoutId = crypto.randomUUID();
    // What WHOOP has. The tests change it, as WHOOP's data changes.
    const whoop = {
      cycles: [
        {
          ...record,
          end: `${day}T22:30:00Z`,
          id: 1,
          score: { kilojoule: 8368, strain: 12.4 },
          start: `${dayBefore}T22:00:00Z`,
        },
      ],
      recoveries: [
        {
          ...record,
          cycle_id: 1,
          score: { recovery_score: 81 },
          sleep_id: sleepId,
        },
      ],
      sleeps: [
        {
          ...record,
          cycle_id: 1,
          end: `${day}T06:00:00Z`,
          id: sleepId,
          nap: false,
          score: {
            sleep_performance_percentage: 88,
            stage_summary: {
              total_light_sleep_time_milli: 4 * 3_600_000,
              total_rem_sleep_time_milli: 1.5 * 3_600_000,
              total_slow_wave_sleep_time_milli: 1.5 * 3_600_000,
            },
          },
          start: `${dayBefore}T22:00:00Z`,
        },
        {
          ...record,
          cycle_id: 1,
          end: `${day}T14:30:00Z`,
          id: napId,
          nap: true,
          start: `${day}T14:00:00Z`,
        },
      ],
      workouts: [
        {
          ...record,
          end: `${day}T18:00:00Z`,
          id: workoutId,
          score: { strain: 8.2 },
          sport_name: "running",
          start: `${day}T17:00:00Z`,
        },
      ],
    };
    const fetches: string[] = [];
    const list = (name: keyof typeof whoop) => () =>
      Effect.sync(() => {
        fetches.push(name);
        return whoop[name];
      });
    const get = (name: "sleeps" | "workouts") => (id: string) =>
      Effect.suspend(() => {
        fetches.push(`get ${name}`);
        const found = whoop[name].find((item) => item.id === id);
        return found ? Effect.succeed(found) : Effect.fail(new Error("404"));
      });
    mock.module("@kompose/whoop/client", () => ({
      createWhoopClient: () => ({
        getSleep: get("sleeps"),
        getWorkout: get("workouts"),
        listCycles: list("cycles"),
        listRecoveries: list("recoveries"),
        listSleeps: list("sleeps"),
        listWorkouts: list("workouts"),
      }),
    }));
    const published: { channel: string; message: string }[] = [];
    mock.module("@kompose/redis", () => ({
      createSubscriber: () => {
        throw new Error("Unexpected subscription");
      },
      redis: {
        publish: (channel: string, message: string) => {
          published.push({ channel, message });
          return Promise.resolve(1);
        },
      },
    }));
    const { db } = await import("@kompose/db/legacy");
    const { DatabaseLive } = await import("@kompose/db");
    const { activityTable } = await import("@kompose/db/schema/activity");
    const { account, user } = await import("@kompose/db/schema/auth");
    const { connectionTable } = await import("@kompose/db/schema/connection");
    const { eq } = await import("drizzle-orm");
    const { WhoopService } = await import("./service");
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(DatabaseLive, WhoopService.layer)
    );

    const userId = `whoop-sync-${crypto.randomUUID()}`;
    const accountId = `whoop-account-${crypto.randomUUID()}`;
    const connectionId = crypto.randomUUID();
    // WHOOP user IDs are integers; a random one keeps runs apart.
    const whoopUserId = String(Math.floor(Math.random() * 1e9));
    const now = new Date();
    await db.insert(user).values({
      createdAt: now,
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: "WHOOP sync test",
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
    await db
      .insert(connectionTable)
      .values({ accountId, id: connectionId, pluginId: "whoop", userId });

    const run = <A, E>(
      use: (
        service: (typeof WhoopService)["Service"]
      ) => Effect.Effect<A, E, Layer.Success<typeof DatabaseLive>>
    ) => runtime.runPromise(WhoopService.use(use));
    const readDay = async () => {
      const [summary] = await run((service) =>
        service.listDaySummaries({
          accountId: whoopUserId,
          endDate: day,
          startDate: day,
          userId,
        })
      );
      return summary;
    };
    const syncedFrom = async () => {
      const [connection] = await db
        .select()
        .from(connectionTable)
        .where(eq(connectionTable.id, connectionId));
      return connection?.syncedFrom;
    };
    const lists = ["cycles", "recoveries", "sleeps", "workouts"];

    try {
      // The first read stores 90 days of history.
      const first = await readDay();
      expect(first).toMatchObject({
        day,
        naps: [
          {
            end: `${day}T14:30:00.000Z`,
            id: napId,
            start: `${day}T14:00:00.000Z`,
            // WHOOP hasn't scored the nap, so it counts the time in bed.
            totalSleepMilliseconds: 30 * 60_000,
          },
        ],
        recoveryScore: 81,
        sleep: {
          end: `${day}T06:00:00.000Z`,
          id: sleepId,
          start: `${dayBefore}T22:00:00.000Z`,
          totalSleepMilliseconds: 7 * 3_600_000,
        },
        sleepPerformance: 88,
        strainScore: 12.4,
        workouts: [
          {
            end: `${day}T18:00:00.000Z`,
            id: workoutId,
            sportName: "running",
            start: `${day}T17:00:00.000Z`,
            strainScore: 8.2,
          },
        ],
      });
      expect(first?.kilojoule).toBeCloseTo(8368);
      expect(fetches.sort()).toEqual(lists);
      expect(await syncedFrom()).toBe(today.subtract({ days: 90 }).toString());

      // Every later read of those days answers from the stored rows.
      expect(await readDay()).toEqual(first);
      expect(fetches).toHaveLength(4);

      // A jump to days long before the stored history fetches those days
      // alone, on every read, and leaves the history where it was.
      const daysAgo = (days: number) => today.subtract({ days }).toString();
      const readRange = (startDate: string, endDate: string) =>
        run((service) =>
          service.listDaySummaries({
            accountId: whoopUserId,
            endDate,
            startDate,
            userId,
          })
        );
      await readRange(daysAgo(200), daysAgo(180));
      await readRange(daysAgo(200), daysAgo(180));
      expect(fetches).toHaveLength(12);
      expect(await syncedFrom()).toBe(daysAgo(90));

      // A read that reaches the stored history extends it.
      await readRange(daysAgo(120), daysAgo(85));
      await readRange(daysAgo(120), daysAgo(85));
      expect(fetches).toHaveLength(16);
      expect(await syncedFrom()).toBe(daysAgo(120));

      // A webhook for a changed workout fetches its days again and tells
      // the owner's clients.
      fetches.length = 0;
      const [workout] = whoop.workouts;
      if (!workout) {
        throw new Error("No workout");
      }
      workout.score.strain = 9.9;
      const changed = (type: string, id: string, forUser = whoopUserId) =>
        run((service) =>
          service.dataChanged({ id, type, whoopUserId: forUser })
        );
      await changed("workout.updated", workoutId);
      expect(fetches.sort()).toEqual([...lists, "get workouts"].sort());
      expect(published).toEqual([
        {
          channel: `user:${userId}`,
          message: JSON.stringify({ payload: {}, type: "whoop" }),
        },
      ]);
      expect((await readDay())?.workouts[0]?.strainScore).toBe(9.9);

      // WHOOP sends a sleep's and its recovery's webhooks together, so two
      // syncs of the same days run at once.
      await Promise.all([
        changed("sleep.updated", sleepId),
        changed("recovery.updated", sleepId),
      ]);
      expect(published).toHaveLength(3);

      // A deleted workout can't be read from WHOOP: its stored row names
      // the days, and the sync removes it.
      fetches.length = 0;
      whoop.workouts = [];
      await changed("workout.deleted", workoutId);
      expect(fetches.sort()).toEqual(lists);
      expect((await readDay())?.workouts).toEqual([]);
      expect(published).toHaveLength(4);

      // A record that was never stored, or a WHOOP user nobody has linked,
      // changes nothing.
      fetches.length = 0;
      await changed("workout.deleted", crypto.randomUUID());
      await changed("sleep.updated", sleepId, `${whoopUserId}0`);
      expect(fetches).toEqual([]);
      expect(published).toHaveLength(4);

      // A client connecting fetches the recent days again: a day's strain
      // has no webhook. A second client right after it doesn't.
      const [cycle] = whoop.cycles;
      if (!cycle) {
        throw new Error("No cycle");
      }
      cycle.score.strain = 14;
      await run((service) => service.syncRecent(userId));
      await run((service) => service.syncRecent(userId));
      expect(fetches.sort()).toEqual(lists);
      expect(published).toHaveLength(5);
      expect((await readDay())?.strainScore).toBe(14);

      // Unlinking deletes the stored data with the connection.
      await db.delete(account).where(eq(account.id, accountId));
      expect(
        await db
          .select()
          .from(activityTable)
          .where(eq(activityTable.connectionId, connectionId))
      ).toEqual([]);
      await expect(readDay()).rejects.toMatchObject({
        _tag: "LinkedAccountError",
      });
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await runtime.dispose();
    }
  });
});
