import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";

// Uses the real services, Better Auth token lookup and Postgres advisory lock.
// Google's HTTP API and the final delete failure are injected.
// Use a migrated, disposable DATABASE_URL.
describe.skipIf(!process.env.DATABASE_URL)(
  "Google webhook reconciliation with Postgres",
  () => {
    const userId = `webhook-test-${crypto.randomUUID()}`;
    const accountId = `webhook-account-${crypto.randomUUID()}`;
    let mode:
      | "ok"
      | "unsupported"
      | "create-fails"
      | "stop-fails"
      | "mixed-failure" = "ok";
    let calendarIds = ["calendar"];
    let watchCalls: string[] = [];
    let stops: string[] = [];
    let persistedAtStop: string[] = [];
    const fetchSpy = spyOn(globalThis, "fetch");
    let releaseWatch: (() => void) | undefined;
    let watchStarted: (() => void) | undefined;
    let watchGate: Promise<void> | undefined;

    let modules: {
      db: typeof import("@kompose/db/legacy")["db"];
      eq: typeof import("drizzle-orm")["eq"];
      auth: typeof import("@kompose/auth")["auth"];
      schema: typeof import("@kompose/db/schema/auth");
      subscriptions: typeof import("@kompose/db/schema/webhook-subscription")["webhookSubscriptionTable"];
      state: typeof import("@kompose/db/schema/webhook-account-state")["webhookAccountStateTable"];
      service: typeof import("./webhook-service")["WebhookService"];
    };
    let runtime: ManagedRuntime.ManagedRuntime<
      | import("./webhook-service").WebhookService
      | import("@kompose/db").Database,
      never
    >;

    const rows = () =>
      modules.db
        .select()
        .from(modules.subscriptions)
        .where(modules.eq(modules.subscriptions.accountId, accountId));
    const reconcile = () =>
      runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* modules.service;
          yield* service.refreshAll({ accountId, userId });
        })
      );

    const insertAccount = async () => {
      const now = new Date();
      await modules.db.insert(modules.schema.account).values({
        accessToken: "test-token",
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        accountId: "google-provider-id",
        createdAt: now,
        id: accountId,
        providerId: "google",
        scope: "https://www.googleapis.com/auth/calendar",
        updatedAt: now,
        userId,
      });
    };

    beforeAll(async () => {
      process.env.SKIP_ENV_VALIDATION = "1";
      process.env.REDIS_URL ??= "redis://localhost:6379";
      process.env.NEXT_PUBLIC_WEB_URL = "https://webhook-test.example.com";
      process.env.GOOGLE_WEBHOOK_TOKEN = "test-webhook-token";
      process.env.BETTER_AUTH_SECRET ??=
        "test-only-better-auth-secret-at-least-32-characters";
      process.env.GOOGLE_CLIENT_ID ??= "test-client";
      process.env.GOOGLE_CLIENT_SECRET ??= "test-secret";
      const [
        { db },
        { eq },
        { auth },
        schema,
        { webhookSubscriptionTable },
        { webhookAccountStateTable },
        { WebhookService },
      ] = await Promise.all([
        import("@kompose/db/legacy"),
        import("drizzle-orm"),
        import("@kompose/auth"),
        import("@kompose/db/schema/auth"),
        import("@kompose/db/schema/webhook-subscription"),
        import("@kompose/db/schema/webhook-account-state"),
        import("./webhook-service"),
      ]);
      modules = {
        auth,
        db,
        eq,
        schema,
        service: WebhookService,
        state: webhookAccountStateTable,
        subscriptions: webhookSubscriptionTable,
      };
      const { DatabaseLive, runtimeMemoMap } = await import("@kompose/db");
      runtime = ManagedRuntime.make(
        Layer.mergeAll(WebhookService.layer, DatabaseLive),
        { memoMap: runtimeMemoMap }
      );
      const now = new Date();
      await db.insert(schema.user).values({
        createdAt: now,
        email: `${userId}@example.com`,
        emailVerified: true,
        id: userId,
        name: "Webhook test",
        updatedAt: now,
      });

      const googleApi = async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        const url = new URL(String(input));
        if (url.origin !== "https://www.googleapis.com") {
          throw new Error(`Unexpected test HTTP request: ${url.origin}`);
        }
        if (url.pathname.endsWith("/channels/stop")) {
          const body: { id: string } = JSON.parse(String(init?.body));
          stops.push(body.id);
          persistedAtStop.push(...(await rows()).map((row) => row.id));
          if (mode === "stop-fails") {
            return Response.json(
              { error: { message: "permission denied" } },
              { status: 403 }
            );
          }
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/watch")) {
          const body: { id: string; expiration: string } = JSON.parse(
            String(init?.body)
          );
          watchCalls.push(url.pathname);
          watchStarted?.();
          await watchGate;
          if (
            mode === "create-fails" ||
            (mode === "mixed-failure" &&
              url.pathname.includes("/calendars/failing/"))
          ) {
            return Response.json(
              { error: { message: "permission denied" } },
              { status: 403 }
            );
          }
          if (
            (mode === "unsupported" || mode === "mixed-failure") &&
            url.pathname.includes("/events/")
          ) {
            return Response.json(
              {
                error: {
                  errors: [{ reason: "pushNotSupportedForRequestedResource" }],
                  message: "Provider capability rejected",
                },
              },
              { status: 400 }
            );
          }
          return Response.json({
            expiration: body.expiration,
            id: body.id,
            resourceId: url.pathname,
          });
        }
        return Response.json({
          items: calendarIds.map((id) => ({ id, summary: id })),
        });
      };
      fetchSpy.mockImplementation(
        Object.assign(googleApi, { preconnect: fetch.preconnect })
      );
    });

    beforeEach(async () => {
      await modules.db
        .delete(modules.schema.account)
        .where(modules.eq(modules.schema.account.id, accountId));
      await insertAccount();
      mode = "ok";
      calendarIds = ["calendar"];
      watchCalls = [];
      stops = [];
      persistedAtStop = [];
      watchGate = undefined;
      watchStarted = undefined;
      releaseWatch = undefined;
    });

    afterAll(async () => {
      releaseWatch?.();
      fetchSpy.mockRestore();
      await modules.db
        .delete(modules.schema.user)
        .where(modules.eq(modules.schema.user.id, userId));
      await runtime.dispose();
    });

    test("overlapping reconciles create one channel per resource", async () => {
      const started = new Promise<void>((resolve) => {
        watchStarted = resolve;
      });
      watchGate = new Promise<void>((resolve) => {
        releaseWatch = resolve;
      });
      const first = reconcile();
      await started;
      const others = Array.from({ length: 4 }, () => reconcile());
      releaseWatch?.();
      await Promise.all([first, ...others]);
      expect(watchCalls).toHaveLength(2);
      expect(await rows()).toHaveLength(2);
    });

    test("replacement creation failure preserves the old tracked channel", async () => {
      await reconcile();
      const original = await rows();
      await modules.db
        .update(modules.subscriptions)
        .set({ expiresAt: new Date(Date.now() + 1000).toISOString() })
        .where(modules.eq(modules.subscriptions.accountId, accountId));
      mode = "create-fails";
      await reconcile();
      expect((await rows()).map((row) => row.id).sort()).toEqual(
        original.map((row) => row.id).sort()
      );
      expect((await rows()).every((row) => row.active)).toBe(true);
      expect(stops).toEqual([]);
    });

    test("failed persistence rolls back replacement and leaves the old channel running", async () => {
      await reconcile();
      const originalIds = (await rows()).map((row) => row.id).sort();
      await modules.db
        .update(modules.subscriptions)
        .set({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
        .where(modules.eq(modules.subscriptions.accountId, accountId));
      const { Database } = await import("@kompose/db");
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = yield* Database;
          const service = yield* modules.service;
          // PostgreSQL rejects the real replacement write after Google creates it.
          yield* db.transaction(
            () => service.refreshAll({ accountId, userId }),
            { accessMode: "read only" }
          );
        })
      );
      expect(watchCalls.length).toBeGreaterThan(2);
      expect((await rows()).map((row) => row.id).sort()).toEqual(originalIds);
      expect((await rows()).every((row) => row.active)).toBe(true);
      expect(stops).toEqual([]);
    });

    test("replacement commits before the old channel is stopped", async () => {
      await reconcile();
      const originalIds = (await rows()).map((row) => row.id);
      await modules.db
        .update(modules.subscriptions)
        .set({ expiresAt: new Date(Date.now() + 1000).toISOString() })
        .where(modules.eq(modules.subscriptions.accountId, accountId));
      await reconcile();
      expect(stops.sort()).toEqual(originalIds.sort());
      expect(persistedAtStop.some((id) => originalIds.includes(id))).toBe(
        false
      );
      expect(await rows()).toHaveLength(2);
    });

    test("unsupported calendars are persisted and skipped on later reconciles", async () => {
      mode = "unsupported";
      await reconcile();
      await reconcile();
      await reconcile();
      expect(
        watchCalls.filter((path) => path.includes("/events/"))
      ).toHaveLength(1);
      const [state] = await modules.db
        .select()
        .from(modules.state)
        .where(modules.eq(modules.state.accountId, accountId));
      expect(
        Date.parse(state?.unsupportedUntil.calendar ?? "")
      ).toBeGreaterThan(Date.now());
    });

    test("unsupported renewal preserves the existing channel and retries after cooldown", async () => {
      await reconcile();
      const original = (await rows()).find(
        (row) => row.config.type === "google-calendar-events"
      );
      if (!original) {
        throw new Error("Expected an event subscription");
      }
      await modules.db
        .update(modules.subscriptions)
        .set({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
        .where(modules.eq(modules.subscriptions.accountId, accountId));
      mode = "unsupported";
      await reconcile();
      const retained = (await rows()).find(
        (row) => row.config.type === "google-calendar-events"
      );
      expect(retained?.id).toBe(original?.id);
      expect(retained?.active).toBe(true);
      expect(stops).not.toContain(original.id);
      await modules.db
        .update(modules.state)
        .set({
          unsupportedUntil: {
            calendar: new Date(Date.now() - 1).toISOString(),
          },
        })
        .where(modules.eq(modules.state.accountId, accountId));
      mode = "ok";
      await reconcile();
      expect(
        (await rows()).find(
          (row) => row.config.type === "google-calendar-events"
        )?.id
      ).not.toBe(original?.id);
      expect(stops).toContain(original.id);
    });

    test("a different calendar failure does not roll back unsupported capability", async () => {
      calendarIds = ["calendar", "failing"];
      mode = "mixed-failure";
      await reconcile();
      await reconcile();
      expect(
        watchCalls.filter((path) => path.includes("/calendars/calendar/"))
      ).toHaveLength(1);
      expect(
        watchCalls.filter((path) => path.includes("/calendars/failing/"))
      ).toHaveLength(2);
      expect(
        (await rows()).filter(
          (row) => row.config.type === "google-calendar-list"
        )
      ).toHaveLength(1);
    });

    test("notifications leave lastNotifiedAt untouched and reject expired channels", async () => {
      await reconcile();
      const subscription = (await rows())[0];
      if (!subscription) {
        throw new Error("Expected a subscription");
      }
      const headers = new Headers({
        "x-goog-channel-id": subscription.id,
        "x-goog-channel-token": "test-webhook-token",
        "x-goog-resource-id": subscription.config.resourceId,
        "x-goog-resource-state": "sync",
      });
      const notify = () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const service = yield* modules.service;
            return yield* service.handleGoogleNotification({ headers });
          })
        );
      await notify();
      expect(
        (await rows()).find((row) => row.id === subscription.id)?.lastNotifiedAt
      ).toBeNull();
      await modules.db
        .update(modules.subscriptions)
        .set({ expiresAt: new Date(Date.now() - 1).toISOString() })
        .where(modules.eq(modules.subscriptions.id, subscription.id));
      await expect(notify()).rejects.toMatchObject({
        _tag: "WebhookRepositoryError",
      });
    });

    test("Better Auth delete hook stops channels before their rows cascade", async () => {
      await reconcile();
      const originalIds = (await rows()).map((row) => row.id);
      const context = await modules.auth.$context;
      await context.internalAdapter.deleteAccount(accountId);
      expect(stops.sort()).toEqual(originalIds.sort());
      expect(persistedAtStop.length).toBeGreaterThan(0);
      expect(await rows()).toEqual([]);
    });

    test("unlink waits for reconciliation and prevents waiting reconciles from recreating watches", async () => {
      const started = new Promise<void>((resolve) => {
        watchStarted = resolve;
      });
      watchGate = new Promise<void>((resolve) => {
        releaseWatch = resolve;
      });
      const inFlight = reconcile();
      await started;
      const context = await modules.auth.$context;
      const unlink = context.internalAdapter.deleteAccount(accountId);
      const waiting = reconcile();
      releaseWatch?.();
      await Promise.all([inFlight, unlink, waiting]);
      expect(watchCalls).toHaveLength(2);
      expect(stops).toHaveLength(2);
      expect(await rows()).toEqual([]);
    });

    test("unlink waits beyond the remote cleanup budget for the account lock", async () => {
      const started = new Promise<void>((resolve) => {
        watchStarted = resolve;
      });
      watchGate = new Promise<void>((resolve) => {
        releaseWatch = resolve;
      });
      const inFlight = reconcile();
      await started;
      const context = await modules.auth.$context;
      let deleted = false;
      const unlink = context.internalAdapter
        .deleteAccount(accountId)
        .then(() => {
          deleted = true;
        });
      try {
        // Exercise the real ten-second Effect timeout while Postgres holds the
        // lock. Cleanup's private runtime does not expose a controllable clock.
        await delay(10_100);
        expect(deleted).toBe(false);
      } finally {
        releaseWatch?.();
        await Promise.all([inFlight, unlink]);
      }
      expect(stops).toHaveLength(2);
      expect(await rows()).toEqual([]);
    }, 20_000);

    test("a failed unlink intent write prevents Better Auth account deletion", async () => {
      await reconcile();
      await modules.db.execute(sql`
        create function fail_unlink_intent() returns trigger language plpgsql as
        $$ begin raise exception 'test unlink coordination failure'; end $$
      `);
      try {
        await modules.db.execute(sql`
          create trigger fail_unlink_intent before insert or update
          on webhook_account_state for each row execute function fail_unlink_intent()
        `);
        const context = await modules.auth.$context;
        await expect(
          context.internalAdapter.deleteAccount(accountId)
        ).rejects.toThrow();
        expect(stops).toEqual([]);
        expect((await rows()).every((row) => row.active)).toBe(true);
        expect(
          await modules.db
            .select()
            .from(modules.schema.account)
            .where(modules.eq(modules.schema.account.id, accountId))
        ).toHaveLength(1);
      } finally {
        await modules.db.execute(sql`
          drop trigger if exists fail_unlink_intent on webhook_account_state
        `);
        await modules.db.execute(sql`drop function fail_unlink_intent()`);
      }
    });

    test("fresh watches recover after stopping succeeds but account deletion fails", async () => {
      await reconcile();
      const original = await rows();
      expect(original).toHaveLength(2);
      expect(
        original.every(
          (row) => Date.parse(row.expiresAt ?? "") > Date.now() + 86_400_000
        )
      ).toBe(true);
      const context = await modules.auth.$context;
      const deletion = spyOn(context.adapter, "delete").mockRejectedValueOnce(
        new Error("test account deletion failure")
      );
      try {
        await expect(
          context.internalAdapter.deleteAccount(accountId)
        ).rejects.toThrow("test account deletion failure");
      } finally {
        deletion.mockRestore();
      }
      expect(stops.sort()).toEqual(original.map((row) => row.id).sort());
      expect((await rows()).every((row) => !row.active)).toBe(true);
      await modules.db
        .update(modules.state)
        .set({ unlinkingUntil: new Date(Date.now() - 1).toISOString() })
        .where(modules.eq(modules.state.accountId, accountId));
      await reconcile();
      expect(watchCalls).toHaveLength(4);
      expect((await rows()).every((row) => row.active)).toBe(true);
      expect(
        (await rows()).some((row) => original.some((old) => old.id === row.id))
      ).toBe(false);
    });

    test("expired unlink intent allows coverage to recover after a failed delete", async () => {
      await modules.db.insert(modules.state).values({
        accountId,
        unlinkingUntil: new Date(Date.now() + 60_000).toISOString(),
      });
      await reconcile();
      expect(watchCalls).toEqual([]);
      await modules.db
        .update(modules.state)
        .set({ unlinkingUntil: new Date(Date.now() - 1).toISOString() })
        .where(modules.eq(modules.state.accountId, accountId));
      await reconcile();
      expect(watchCalls).toHaveLength(2);
    });

    test("missing Google token does not block unlink", async () => {
      await reconcile();
      await modules.db
        .update(modules.schema.account)
        .set({ accessToken: null, accessTokenExpiresAt: new Date(0) })
        .where(modules.eq(modules.schema.account.id, accountId));
      const context = await modules.auth.$context;
      await context.internalAdapter.deleteAccount(accountId);
      expect(stops).toEqual([]);
      expect(await rows()).toEqual([]);
    });

    test("Google stop failure does not block Better Auth unlink", async () => {
      await reconcile();
      mode = "stop-fails";
      const context = await modules.auth.$context;
      await context.internalAdapter.deleteAccount(accountId);
      expect(stops).toHaveLength(2);
      expect(await rows()).toEqual([]);
    });
  }
);
