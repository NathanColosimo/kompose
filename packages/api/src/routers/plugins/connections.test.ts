import { describe, expect, mock, test } from "bun:test";
import { ManagedRuntime } from "effect";

// Run with a migrated scratch DATABASE_URL. Redis, the provider lookup and
// Vercel's waitUntil are faked.
describe.skipIf(!process.env.DATABASE_URL)("plugins.connections", () => {
  test("stores a profile on first read, answers from it after, and refreshes a stale one after the reply", async () => {
    mock.module("@kompose/redis", () => ({
      createSubscriber: () => {
        throw new Error("Unexpected subscription");
      },
      redis: { eval: () => Promise.resolve([1, 60_000]) },
    }));
    const ada = {
      email: "ada@example.com",
      image: "https://example.com/ada.png",
      name: "Ada",
    };
    let lookups = 0;
    let profile: typeof ada | null = ada;
    mock.module("@kompose/auth", () => ({
      auth: {
        api: {
          accountInfo: () => {
            lookups += 1;
            return profile
              ? Promise.resolve({ user: profile })
              : Promise.reject(new Error("provider down"));
          },
        },
      },
    }));
    const afterReply: Promise<unknown>[] = [];
    mock.module("@vercel/functions", () => ({
      waitUntil: (work: Promise<unknown>) => {
        afterReply.push(work);
      },
    }));

    const { db } = await import("@kompose/db/legacy");
    const { DatabaseLive } = await import("@kompose/db");
    const { account, user } = await import("@kompose/db/schema/auth");
    const { connectionTable } = await import("@kompose/db/schema/connection");
    const { eq } = await import("drizzle-orm");
    const { call } = await import("@orpc/server");
    const { pluginsRouter } = await import("./router");

    const runtime = ManagedRuntime.make(DatabaseLive);
    const userId = `connections-test-${crypto.randomUUID()}`;
    const accountId = `connections-account-${crypto.randomUUID()}`;
    const connectionId = crypto.randomUUID();
    const now = new Date();
    const testUser = {
      createdAt: now,
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: "Connections test",
      updatedAt: now,
    };
    await db.insert(user).values(testUser);
    await db.insert(account).values({
      accountId: "provider",
      createdAt: now,
      id: accountId,
      providerId: "google",
      updatedAt: now,
      userId,
    });
    await db.insert(connectionTable).values({
      accountId,
      id: connectionId,
      pluginId: "google-calendar",
      userId,
    });

    try {
      // The handler uses only the database from this runtime.
      const context = {
        "effect/context": await runtime.context(),
        user: testUser,
      } as import("../../context").Context;
      const list = () =>
        call(pluginsRouter.connections, undefined, { context });
      // First read: no stored profile, so it asks the provider and stores it.
      expect(await list()).toMatchObject([ada]);
      expect(lookups).toBe(1);

      // Later reads answer from the row.
      expect(await list()).toMatchObject([ada]);
      expect(lookups).toBe(1);
      expect(afterReply).toHaveLength(0);

      // A profile older than a day: the reply still has the stored one, and
      // the new one is fetched after it.
      await db
        .update(connectionTable)
        .set({
          profileUpdatedAt: new Date(
            Date.now() - 25 * 60 * 60 * 1000
          ).toISOString(),
        })
        .where(eq(connectionTable.id, connectionId));
      profile = { ...ada, name: "Ada Lovelace" };
      expect(await list()).toMatchObject([ada]);
      await Promise.all(afterReply);
      expect(lookups).toBe(2);
      expect(await list()).toMatchObject([profile]);
      expect(lookups).toBe(2);

      // A failed refresh keeps what is stored.
      await db
        .update(connectionTable)
        .set({ profileUpdatedAt: "2026-01-01T00:00:00.000Z" })
        .where(eq(connectionTable.id, connectionId));
      profile = null;
      afterReply.length = 0;
      await list();
      await Promise.all(afterReply);
      expect(lookups).toBe(3);
      const [row] = await db
        .select()
        .from(connectionTable)
        .where(eq(connectionTable.id, connectionId));
      expect(row).toMatchObject({ ...ada, name: "Ada Lovelace" });

      // A connection that needs reconnecting is never asked.
      await db
        .update(connectionTable)
        .set({ profileUpdatedAt: null, status: "needs-reauth" })
        .where(eq(connectionTable.id, connectionId));
      afterReply.length = 0;
      await list();
      expect(afterReply).toHaveLength(0);
      expect(lookups).toBe(3);
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await runtime.dispose();
    }
  });
});
