import { describe, expect, mock, test } from "bun:test";
import { Layer, ManagedRuntime } from "effect";

// Run with a migrated scratch DATABASE_URL. Redis and the WHOOP API are faked.
describe.skipIf(!process.env.DATABASE_URL)("days.list", () => {
  test("returns the user's own stored days, with the plugin of each row", async () => {
    mock.module("@kompose/redis", () => ({
      createSubscriber: () => {
        throw new Error("Unexpected subscription");
      },
      redis: { eval: () => Promise.resolve([1, 60_000]) },
    }));
    mock.module("@kompose/whoop/client", () => ({
      createWhoopClient: () => {
        throw new Error("Stored days need no request to WHOOP");
      },
    }));
    const { db } = await import("@kompose/db/legacy");
    const { DatabaseLive } = await import("@kompose/db");
    const { activityTable } = await import("@kompose/db/schema/activity");
    const { account, user } = await import("@kompose/db/schema/auth");
    const { connectionTable } = await import("@kompose/db/schema/connection");
    const { dayMetricTable } = await import("@kompose/db/schema/day-metric");
    const { inArray } = await import("drizzle-orm");
    const { call } = await import("@orpc/server");
    const { WhoopService } = await import("../whoop/service");
    const { daysRouter } = await import("./router");
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(DatabaseLive, WhoopService.layer)
    );

    const now = new Date();
    const activityId = crypto.randomUUID();
    /** A user with a WHOOP connection that has one workout and one number. */
    const addUser = async (strain: number, id = crypto.randomUUID()) => {
      const testUser = {
        createdAt: now,
        email: `${id}@example.com`,
        emailVerified: true,
        id: `days-list-${id}`,
        name: "Days list test",
        updatedAt: now,
      };
      const connectionId = crypto.randomUUID();
      await db.insert(user).values(testUser);
      await db.insert(account).values({
        accountId: id,
        createdAt: now,
        id: `account-${id}`,
        providerId: "whoop",
        updatedAt: now,
        userId: testUser.id,
      });
      await db.insert(connectionTable).values({
        accountId: `account-${id}`,
        id: connectionId,
        pluginId: "whoop",
        // The read's days are already stored.
        syncedFrom: "2026-01-01",
        userId: testUser.id,
      });
      await db.insert(dayMetricTable).values({
        connectionId,
        date: "2026-11-05",
        metric: "strain",
        value: strain,
      });
      await db.insert(activityTable).values({
        connectionId,
        date: "2026-11-05",
        details: { strain },
        endAt: new Date("2026-11-05T18:00:00Z"),
        externalId: "workout",
        id: strain === 8.2 ? activityId : crypto.randomUUID(),
        kind: "workout",
        startAt: new Date("2026-11-05T17:00:00Z"),
        title: "running",
      });
      return testUser;
    };
    const reader = await addUser(8.2);
    const other = await addUser(15);

    try {
      // This procedure consumes only the services supplied by this runtime.
      const context = {
        "effect/context": await runtime.context(),
        user: reader,
      } as import("../../context").Context;
      expect(
        await call(
          daysRouter.list,
          { endDate: "2026-11-30", startDate: "2026-11-01" },
          { context }
        )
      ).toEqual({
        activities: [
          {
            date: "2026-11-05",
            details: { strain: 8.2 },
            endAt: "2026-11-05T18:00:00.000Z",
            id: activityId,
            kind: "workout",
            pluginId: "whoop",
            startAt: "2026-11-05T17:00:00.000Z",
            title: "running",
          },
        ],
        metrics: [
          {
            date: "2026-11-05",
            metric: "strain",
            pluginId: "whoop",
            value: 8.2,
          },
        ],
      });
    } finally {
      await db.delete(user).where(inArray(user.id, [reader.id, other.id]));
      await runtime.dispose();
    }
  });
});
