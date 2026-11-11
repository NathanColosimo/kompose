import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import type { Account } from "better-auth";
import { Effect, Exit, Layer, ManagedRuntime } from "effect";

describe.skipIf(!process.env.DATABASE_URL)(
  "watch renewal with Postgres",
  () => {
    const userId = `watch-test-${crypto.randomUUID()}`;
    const now = new Date();
    const linked: Account = {
      accessToken: "test-token",
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      accountId: "provider",
      createdAt: now,
      id: `watch-account-${crypto.randomUUID()}`,
      providerId: "google",
      updatedAt: now,
      userId,
    };
    const oldId = crypto.randomUUID();
    let mode: "fail" | "ok" = "ok";
    let stops: string[] = [];
    const created: string[] = [];
    let savedAtStop: { active: boolean; id: string }[][] = [];
    let watchGate = Promise.resolve();
    let onWatch: (() => void) | undefined;
    const fetchSpy = spyOn(globalThis, "fetch");
    let modules: {
      db: typeof import("@kompose/db/legacy")["db"];
      eq: typeof import("drizzle-orm")["eq"];
      schema: typeof import("@kompose/db/schema/auth");
      subs: typeof import("@kompose/db/schema/webhook-subscription")["webhookSubscriptionTable"];
      service: typeof import("./webhook-service")["GoogleCalendarWebhookService"];
      google: typeof import("@kompose/google-cal/client");
    };
    let runtime: ManagedRuntime.ManagedRuntime<
      | import("./webhook-service").GoogleCalendarWebhookService
      | import("@kompose/db").Database,
      never
    >;
    const rows = () =>
      modules.db
        .select()
        .from(modules.subs)
        .where(modules.eq(modules.subs.accountId, linked.id));
    const renew = (account = linked) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const [existing] = yield* Effect.promise(rows);
          if (existing?.config.type !== "google-calendar-list") {
            return yield* Effect.die(new Error("Missing list subscription"));
          }
          const service = yield* modules.service;
          return yield* Effect.exit(
            service.refreshListWatch({
              account,
              existingSubscription: { ...existing, config: existing.config },
              userId,
            })
          );
        }).pipe(
          Effect.provideService(
            modules.google.GoogleCalendar,
            modules.google.makeGoogleCalendarService("test-token")
          )
        )
      );

    beforeAll(async () => {
      const [
        { db },
        { eq },
        schema,
        { webhookSubscriptionTable },
        { GoogleCalendarWebhookService },
        google,
      ] = await Promise.all([
        import("@kompose/db/legacy"),
        import("drizzle-orm"),
        import("@kompose/db/schema/auth"),
        import("@kompose/db/schema/webhook-subscription"),
        import("./webhook-service"),
        import("@kompose/google-cal/client"),
      ]);
      modules = {
        db,
        eq,
        google,
        schema,
        service: GoogleCalendarWebhookService,
        subs: webhookSubscriptionTable,
      };
      const { DatabaseLive } = await import("@kompose/db");
      runtime = ManagedRuntime.make(
        Layer.mergeAll(GoogleCalendarWebhookService.layer, DatabaseLive)
      );
      await db.insert(schema.user).values({
        createdAt: now,
        email: `${userId}@example.com`,
        id: userId,
        name: "Watch test",
        updatedAt: now,
      });
      await db.insert(schema.account).values(linked);
      const googleApi: typeof fetch = Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1]
        ) => {
          const url = String(input);
          const body = JSON.parse(String(init?.body));
          if (url.endsWith("/watch")) {
            if (mode === "fail") {
              return Response.json(
                { error: { message: "watch rejected" } },
                { status: 400 }
              );
            }
            created.push(body.id);
            onWatch?.();
            await watchGate;
            return Response.json({
              expiration: String(Date.now() + 86_400_000),
              id: body.id,
              resourceId: "resource",
            });
          }
          if (url.endsWith("/channels/stop")) {
            stops.push(body.id);
            savedAtStop.push(
              (await rows()).map(({ id, active }) => ({ id, active }))
            );
            return new Response(null, { status: 204 });
          }
          throw new Error(`Unexpected Google request: ${url}`);
        },
        { preconnect: fetch.preconnect }
      );
      fetchSpy.mockImplementation(googleApi);
    });
    beforeEach(async () => {
      stops = [];
      savedAtStop = [];
      watchGate = Promise.resolve();
      onWatch = undefined;
      created.length = 0;
      mode = "ok";
      await modules.db
        .delete(modules.subs)
        .where(modules.eq(modules.subs.accountId, linked.id));
      await modules.db.insert(modules.subs).values({
        accountId: linked.id,
        config: { resourceId: "resource", type: "google-calendar-list" },
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        id: oldId,
        provider: "google",
        providerAccountId: linked.accountId,
        userId,
      });
    });
    afterAll(async () => {
      fetchSpy.mockRestore();
      if (modules) {
        await modules.db
          .delete(modules.schema.user)
          .where(modules.eq(modules.schema.user.id, userId));
      }
      if (runtime) {
        await runtime.dispose();
      }
    });

    test("a failed renewal leaves the old channel running; replacements are saved before it stops", async () => {
      mode = "fail";
      expect(Exit.isFailure(await renew())).toBe(true);
      expect((await rows())[0]?.id).toBe(oldId);
      expect(stops).toEqual([]);
      mode = "ok";
      expect(Exit.isSuccess(await renew())).toBe(true);
      expect(stops).toEqual([oldId]);
      expect((await rows())[0]?.id).toBe(created[0]);
      expect(savedAtStop[0]?.[0]?.id).toBe(created[0]);
      expect(savedAtStop[0]?.[0]?.active).toBe(true);
    });

    test("a failed save stops the new channel and leaves the old one running", async () => {
      expect(
        Exit.isFailure(await renew({ ...linked, id: "missing-account" }))
      ).toBe(true);
      expect(stops).toEqual(created);
      expect((await rows())[0]?.id).toBe(oldId);
    });

    test("overlapping renewals retain one channel and stop the losing replacement", async () => {
      const gate = Promise.withResolvers<void>();
      const bothStarted = Promise.withResolvers<void>();
      watchGate = gate.promise;
      onWatch = () => {
        if (created.length === 2) {
          bothStarted.resolve();
        }
      };
      const renewals = Promise.all([renew(), renew()]);
      await bothStarted.promise;
      gate.resolve();
      const results = await renewals;
      expect(results.every(Exit.isSuccess)).toBe(true);
      const [saved] = await rows();
      expect(created).toHaveLength(2);
      expect(stops).toContain(oldId);
      expect(stops).not.toContain(saved?.id);
      expect(stops).toHaveLength(2);
    });
    test("unlink stops channels and an in-flight renewal cannot reactivate its old row", async () => {
      const gate = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      watchGate = gate.promise;
      onWatch = started.resolve;
      const renewal = renew();
      await started.promise;
      const { auth } = await import("@kompose/auth");
      const hook = auth.options.databaseHooks?.account?.delete?.before;
      if (!hook) {
        throw new Error("Missing account deletion hook");
      }
      await hook(linked);
      expect(stops).toEqual([oldId]);
      expect(savedAtStop).toEqual([[{ id: oldId, active: false }]]);
      gate.resolve();
      expect(Exit.isSuccess(await renewal)).toBe(true);
      expect(stops).toEqual([oldId, ...created]);
      expect((await rows())[0]?.active).toBe(false);
      await modules.db
        .delete(modules.schema.account)
        .where(modules.eq(modules.schema.account.id, linked.id));
      expect(await rows()).toEqual([]);
    });
  }
);
