/// <reference types="bun" />

/**
 * TaskService's series writes against a real Postgres. Opt-in: CI has no
 * database yet, so these run only with TASK_SERIES_TEST_DATABASE_URL set.
 * They write demo users and tasks and delete them after, so the URL must
 * name a throwaway database: one whose name has "test" or "scratch" as a
 * word, split by "_" or "-" (kompose_test, kompose_series_test,
 * scratch-kompose). Any other name fails before connecting. To run them
 * from packages/api against the local Docker Postgres:
 *
 *   docker exec -i kompose-postgres psql -U postgres -c "create database kompose_test"
 *   (cd ../db && DATABASE_URL=postgres://…/kompose_test bunx drizzle-kit migrate)
 *   SKIP_ENV_VALIDATION=1 TASK_SERIES_TEST_DATABASE_URL=postgres://…/kompose_test \
 *     bun test src/routers/task/client.db.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "@kompose/db";
import type { TaskRecurrence, TaskSelect } from "@kompose/db/schema/task";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { TaskService } from "./client";
import type { DeleteScope, UpdateScope } from "./contract";

type TaskUpdateInput = Parameters<TaskService["Service"]["updateTask"]>[2];

const testDatabaseUrl = process.env.TASK_SERIES_TEST_DATABASE_URL;

const SCRATCH_DATABASE_NAME = /(^|[_-])(test|scratch)([_-]|$)/i;

/** The database a URL names, if it's marked as throwaway; else throws why. */
function scratchDatabaseName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!SCRATCH_DATABASE_NAME.test(name)) {
    throw new Error(
      `TASK_SERIES_TEST_DATABASE_URL names the database "${name}", which isn't marked as throwaway. These tests write and delete rows, so its name must have "test" or "scratch" as a word split by "_" or "-" (for example kompose_test).`
    );
  }
  return name;
}

// @kompose/db reads DATABASE_URL as it loads, so it's pointed at the test
// database before the first import.
async function loadModules(url: string) {
  process.env.DATABASE_URL = url;
  const [db, auth, tag, task, drizzle, client] = await Promise.all([
    import("@kompose/db"),
    import("@kompose/db/schema/auth"),
    import("@kompose/db/schema/tag"),
    import("@kompose/db/schema/task"),
    import("drizzle-orm"),
    import("./client"),
  ]);
  return { auth, client, db, drizzle, tag, task };
}

/** A pattern, short: "DAILY/1 x4", "WEEKLY/1 MO until 2026-11-30". */
function rule(recurrence: TaskRecurrence): string {
  const days = "byDay" in recurrence ? ` ${recurrence.byDay.join(",")}` : "";
  const count = recurrence.count ? ` x${recurrence.count}` : "";
  const until = recurrence.until ? ` until ${recurrence.until}` : "";
  return `${recurrence.freq}/${recurrence.interval}${days}${count}${until}`;
}

// Sorts undated (inbox) tasks after every date.
const INBOX_LAST = "9999-12-31";

/**
 * A user's tasks, one line each, by date (inbox last) then title: date,
 * title, status, "exc" for an exception, the due date, its series role
 * ("alone", "MASTER <rule>", or "in <its master's date>"), and its tags.
 */
function describeRows(
  rows: TaskSelect[],
  tags: { name: string; taskId: string }[]
): string[] {
  const dates = new Map(rows.map((row) => [row.id, row.startDate ?? "inbox"]));
  return rows
    .toSorted(
      (a, b) =>
        (a.startDate ?? INBOX_LAST).localeCompare(b.startDate ?? INBOX_LAST) ||
        a.title.localeCompare(b.title)
    )
    .map((row) => {
      let role = "alone";
      if (row.seriesMasterId === row.id) {
        role = `MASTER ${row.recurrence ? rule(row.recurrence) : "none"}`;
      } else if (row.seriesMasterId) {
        role = `in ${dates.get(row.seriesMasterId) ?? "missing"}`;
      }
      const parts = [
        row.startDate ?? "inbox",
        row.title,
        row.status,
        ...(row.isException ? ["exc"] : []),
        ...(row.dueDate ? [`due ${row.dueDate}`] : []),
        role,
        ...tags
          .filter((tag) => tag.taskId === row.id)
          .map((tag) => `#${tag.name}`)
          .sort(),
      ];
      // A pattern belongs on its master alone.
      if (row.recurrence && row.seriesMasterId !== row.id) {
        parts.push(`stray ${rule(row.recurrence)}`);
      }
      return parts.join(" ");
    });
}

const daily = (count: number): TaskRecurrence => ({
  count,
  freq: "DAILY",
  interval: 1,
});
const mondays = (count: number): TaskRecurrence => ({
  byDay: ["MO"],
  count,
  freq: "WEEKLY",
  interval: 1,
});

describe("scratchDatabaseName", () => {
  test("accepts a database marked as test or scratch", () => {
    expect(
      scratchDatabaseName("postgres://u:p@localhost:5432/kompose_test")
    ).toBe("kompose_test");
    expect(
      scratchDatabaseName("postgres://u:p@localhost:5432/scratch-kompose")
    ).toBe("scratch-kompose");
  });

  test("refuses any other database, saying why", () => {
    for (const name of ["kompose", "kompose_latest", "contest"]) {
      expect(() =>
        scratchDatabaseName(`postgres://u:p@localhost:5432/${name}`)
      ).toThrow(
        `names the database "${name}", which isn't marked as throwaway`
      );
    }
  });
});

describe.skipIf(!testDatabaseUrl)("TaskService series writes", () => {
  let modules: Awaited<ReturnType<typeof loadModules>>;
  let runtime: ManagedRuntime.ManagedRuntime<Database | TaskService, never>;
  let connected = false;
  const userIds: string[] = [];

  beforeAll(async () => {
    const url = testDatabaseUrl ?? "";
    // Before connecting: only ever a throwaway database.
    const name = scratchDatabaseName(url);
    modules = await loadModules(url);
    runtime = ManagedRuntime.make(
      Layer.mergeAll(modules.client.TaskService.layer, modules.db.DatabaseLive)
    );
    connected = true;
    // And the connection really is to it.
    const { rows } = await runtime.runPromise(
      Effect.gen(function* () {
        const db = yield* modules.db.Database;
        return yield* db.execute<{ name: string }>(
          modules.drizzle.sql`select current_database() as name`
        );
      })
    );
    expect(rows[0]?.name).toBe(name);
  });

  afterAll(async () => {
    // Nothing connected if beforeAll refused the database's name.
    if (!connected) {
      return;
    }
    if (userIds.length > 0) {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = yield* modules.db.Database;
          yield* db
            .delete(modules.auth.user)
            .where(modules.drizzle.inArray(modules.auth.user.id, userIds));
        })
      );
    }
    await runtime.dispose();
  });

  /**
   * Runs `steps` for a new demo user, then returns the user's tasks (see
   * describeRows), plus the error's message if a step failed.
   */
  async function scenario(
    steps: (
      user: ReturnType<typeof forUser>
    ) => Effect.Effect<unknown, unknown, Database>
  ): Promise<string[]> {
    const userId = `demo-series-${crypto.randomUUID()}`;
    userIds.push(userId);
    return await runtime.runPromise(
      Effect.gen(function* () {
        const db = yield* modules.db.Database;
        const now = new Date();
        yield* db.insert(modules.auth.user).values({
          createdAt: now,
          email: `${userId}@example.com`,
          id: userId,
          name: "Demo",
          updatedAt: now,
        });
        const service = yield* modules.client.TaskService;
        const result = yield* Effect.result(steps(forUser(service, userId)));
        const rows = yield* db
          .select()
          .from(modules.task.taskTable)
          .where(modules.drizzle.eq(modules.task.taskTable.userId, userId));
        const { tagTable, taskTagTable } = modules.tag;
        const tags = yield* db
          .select({ name: tagTable.name, taskId: taskTagTable.taskId })
          .from(taskTagTable)
          .innerJoin(
            tagTable,
            modules.drizzle.eq(tagTable.id, taskTagTable.tagId)
          )
          .where(modules.drizzle.eq(tagTable.userId, userId));
        const lines = describeRows(rows, tags);
        if (result._tag === "Success") {
          return lines;
        }
        const { failure } = result;
        return [
          `error: ${failure instanceof Error ? failure.message : String(failure)}`,
          ...lines,
        ];
      })
    );
  }

  /** Steps that find a task by its date (null: the inbox), then act on it. */
  function forUser(service: TaskService["Service"], userId: string) {
    const find = (date: string | null) =>
      Effect.gen(function* () {
        const db = yield* modules.db.Database;
        const rows = yield* db
          .select()
          .from(modules.task.taskTable)
          .where(modules.drizzle.eq(modules.task.taskTable.userId, userId));
        const row = rows.find((candidate) => candidate.startDate === date);
        if (!row) {
          return yield* Effect.die(new Error(`No task on ${date}`));
        }
        return row;
      });
    return {
      create: (
        startDate: string,
        recurrence: TaskRecurrence,
        extra: { dueDate?: string; tagIds?: string[] } = {}
      ) =>
        service.createTask(userId, {
          recurrence,
          startDate,
          title: "Review",
          userId,
          ...extra,
        }),
      remove: (date: string | null, scope: DeleteScope) =>
        Effect.flatMap(find(date), (task) =>
          service.deleteTask(userId, task.id, scope)
        ),
      /** A new tag of the user's, by name; returns its id. */
      tag: (name: string) =>
        Effect.gen(function* () {
          const db = yield* modules.db.Database;
          const [created] = yield* db
            .insert(modules.tag.tagTable)
            .values({ icon: "tag", id: crypto.randomUUID(), name, userId })
            .returning({ id: modules.tag.tagTable.id });
          if (!created) {
            return yield* Effect.die(new Error(`Tag ${name} not created`));
          }
          return created.id;
        }),
      update: (
        date: string | null,
        input: TaskUpdateInput,
        scope: UpdateScope
      ) =>
        Effect.flatMap(find(date), (task) =>
          service.updateTask(userId, task.id, input, scope)
        ),
    };
  }

  test("starts a series that's off its pattern on the day the user placed", async () => {
    // Tuesday Nov 10, weekly on Monday, 3 times.
    expect(await scenario((u) => u.create("2026-11-10", mondays(3)))).toEqual([
      "2026-11-10 Review todo MASTER WEEKLY/1 MO x3",
      "2026-11-16 Review todo in 2026-11-10",
      "2026-11-23 Review todo in 2026-11-10",
    ]);
  });

  test("moves due dates with an occurrence a pattern change moves", async () => {
    const every2Days: TaskRecurrence = { count: 3, freq: "DAILY", interval: 2 };
    // Nov 10 (due Nov 11) moved to Nov 13, every 2 days x3.
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(5), { dueDate: "2026-11-10" });
          yield* u.update(
            "2026-11-10",
            { recurrence: every2Days, startDate: "2026-11-13" },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-09 Review todo due 2026-11-10 MASTER DAILY/1 until 2026-11-09",
      "2026-11-13 Review todo due 2026-11-14 MASTER DAILY/2 x3",
      "2026-11-15 Review todo due 2026-11-16 in 2026-11-13",
      "2026-11-17 Review todo due 2026-11-18 in 2026-11-13",
    ]);
  });

  test("rejects a new pattern with no start date, before any write", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(3));
          yield* u.update("2026-11-10", { status: "done" }, "this");
          yield* u.update(
            "2026-11-10",
            { recurrence: daily(2), startDate: null },
            "following"
          );
        })
      )
    ).toEqual([
      "error: Pick a start date to repeat this task.",
      "2026-11-09 Review todo MASTER DAILY/1 x3",
      "2026-11-10 Review done exc in 2026-11-09",
      "2026-11-11 Review todo in 2026-11-09",
    ]);
  });

  test("rejects a new pattern ending before its start, before any write", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(3));
          yield* u.update(
            "2026-11-10",
            { recurrence: { freq: "DAILY", interval: 1, until: "2026-11-05" } },
            "following"
          );
        })
      )
    ).toEqual([
      "error: The repeat ends before the task starts.",
      "2026-11-09 Review todo MASTER DAILY/1 x3",
      "2026-11-10 Review todo in 2026-11-09",
      "2026-11-11 Review todo in 2026-11-09",
    ]);
  });

  test("keeps an occurrence moved onto a kept task's date, with its edits", async () => {
    // Nov 16 done alone; Nov 9 renamed and moved onto it, Mondays x3.
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", mondays(4));
          yield* u.update("2026-11-16", { status: "done" }, "this");
          yield* u.update(
            "2026-11-09",
            {
              recurrence: mondays(3),
              startDate: "2026-11-16",
              title: "Review v2",
            },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-16 Review done exc in 2026-11-16",
      "2026-11-16 Review v2 todo exc MASTER WEEKLY/1 MO x3",
      "2026-11-23 Review v2 todo in 2026-11-16",
      "2026-11-30 Review v2 todo in 2026-11-16",
    ]);
  });

  test("hands a deleted master's role to the next occurrence, counting what's left", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(4));
          yield* u.remove("2026-11-10", "this");
          yield* u.remove("2026-11-09", "this");
        })
      )
    ).toEqual([
      "2026-11-11 Review todo MASTER DAILY/1 x2",
      "2026-11-12 Review todo in 2026-11-11",
    ]);
  });

  test("keeps the earlier part of a series whose master moved later", async () => {
    // Daily x5; the Nov 9 master moved alone to Nov 20; then Nov 11 takes
    // Wednesdays x2 from there on.
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(5));
          yield* u.update("2026-11-09", { startDate: "2026-11-20" }, "this");
          yield* u.update(
            "2026-11-11",
            {
              recurrence: {
                byDay: ["WE"],
                count: 2,
                freq: "WEEKLY",
                interval: 1,
              },
            },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-10 Review todo MASTER DAILY/1 until 2026-11-10",
      "2026-11-11 Review todo MASTER WEEKLY/1 WE x2",
      "2026-11-18 Review todo in 2026-11-11",
      "2026-11-20 Review todo exc in 2026-11-11",
    ]);
  });

  test("ends a repeat at an occurrence, keeping later edited ones alone", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(5));
          yield* u.update("2026-11-13", { title: "Renamed" }, "this");
          yield* u.update("2026-11-11", { recurrence: null }, "following");
        })
      )
    ).toEqual([
      "2026-11-09 Review todo MASTER DAILY/1 until 2026-11-10",
      "2026-11-10 Review todo in 2026-11-09",
      "2026-11-11 Review todo alone",
      "2026-11-13 Renamed todo alone",
    ]);
  });

  test("sets a following save's status on the edited occurrence alone", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(3));
          yield* u.update(
            "2026-11-10",
            { status: "done", title: "Renamed" },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-09 Review todo MASTER DAILY/1 x3",
      "2026-11-10 Renamed done exc in 2026-11-09",
      "2026-11-11 Renamed todo in 2026-11-09",
    ]);
  });

  test("gives a pattern change's tags to its new rows, not to kept occurrences", async () => {
    // Nov 11 retagged alone, then Nov 10 given Daily x3 tagged Errand.
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          const home = yield* u.tag("Home");
          const work = yield* u.tag("Work");
          const errand = yield* u.tag("Errand");
          yield* u.create("2026-11-09", daily(4), { tagIds: [home] });
          yield* u.update("2026-11-11", { tagIds: [work] }, "this");
          yield* u.update(
            "2026-11-10",
            { recurrence: daily(3), tagIds: [errand] },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-09 Review todo MASTER DAILY/1 until 2026-11-09 #Home",
      "2026-11-10 Review todo MASTER DAILY/1 x3 #Errand",
      "2026-11-11 Review todo exc in 2026-11-10 #Work",
      "2026-11-12 Review todo in 2026-11-10 #Errand",
    ]);
  });

  test("deleting from an occurrence on ends the series there", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(3));
          yield* u.remove("2026-11-10", "following");
        })
      )
    ).toEqual(["2026-11-09 Review todo MASTER DAILY/1 until 2026-11-09"]);
  });

  test("deleting from an occurrence before a master moved later keeps the earlier part", async () => {
    // Daily x5; the Nov 9 master moved alone to Nov 20; then Nov 11 and
    // following deleted, the moved master with them.
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(5));
          yield* u.update("2026-11-09", { startDate: "2026-11-20" }, "this");
          yield* u.remove("2026-11-11", "following");
        })
      )
    ).toEqual(["2026-11-10 Review todo MASTER DAILY/1 until 2026-11-10"]);
  });

  test("deleting a master moved later, and what follows it, keeps the earlier part", async () => {
    // Daily x5; the Nov 9 master moved alone to Nov 20, then deleted with
    // "following".
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(5));
          yield* u.update("2026-11-09", { startDate: "2026-11-20" }, "this");
          yield* u.remove("2026-11-20", "following");
        })
      )
    ).toEqual([
      "2026-11-10 Review todo MASTER DAILY/1 until 2026-11-13",
      "2026-11-11 Review todo in 2026-11-10",
      "2026-11-12 Review todo in 2026-11-10",
      "2026-11-13 Review todo in 2026-11-10",
    ]);
  });

  test("deletes an inbox occurrence alone, even from following", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(3));
          yield* u.update("2026-11-10", { startDate: null }, "this");
          yield* u.remove(null, "following");
        })
      )
    ).toEqual([
      "2026-11-09 Review todo MASTER DAILY/1 x3",
      "2026-11-11 Review todo in 2026-11-09",
    ]);
  });

  test("treats a pattern sent along unchanged, in another key order, as no change", async () => {
    // Postgres returns {freq, count, interval}; this sends {freq, interval,
    // count}, as the router's schema does.
    const sentAlong: TaskRecurrence = { freq: "DAILY", interval: 1, count: 4 };
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(4));
          yield* u.update(
            "2026-11-10",
            { recurrence: sentAlong, title: "Renamed" },
            "following"
          );
          yield* u.update(
            "2026-11-12",
            { recurrence: sentAlong, startDate: "2026-11-14" },
            "this"
          );
        })
      )
    ).toEqual([
      "2026-11-09 Review todo MASTER DAILY/1 x4",
      "2026-11-10 Renamed todo in 2026-11-09",
      "2026-11-11 Renamed todo in 2026-11-09",
      "2026-11-14 Renamed todo exc in 2026-11-09",
    ]);
  });

  test("moves only the occurrence itself to the inbox, even from following", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(4));
          yield* u.update(
            "2026-11-10",
            { startDate: null, title: "Later" },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-09 Review todo MASTER DAILY/1 x4",
      "2026-11-11 Review todo in 2026-11-09",
      "2026-11-12 Review todo in 2026-11-09",
      "inbox Later todo exc in 2026-11-09",
    ]);
  });

  test("makes an inbox occurrence a series of its own from the start it's given", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(3));
          yield* u.update("2026-11-10", { startDate: null }, "this");
          yield* u.update(
            null,
            { recurrence: daily(2), startDate: "2026-11-20" },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-09 Review todo MASTER DAILY/1 x3",
      "2026-11-11 Review todo in 2026-11-09",
      "2026-11-20 Review todo MASTER DAILY/1 x2",
      "2026-11-21 Review todo in 2026-11-20",
    ]);
  });

  test("makes a master moved to the inbox a lone task when its series splits", async () => {
    // Daily x5; the Nov 9 master moved to the inbox; Nov 11 takes
    // Wednesdays x2 from there on.
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(5));
          yield* u.update("2026-11-09", { startDate: null }, "this");
          yield* u.update(
            "2026-11-11",
            {
              recurrence: {
                byDay: ["WE"],
                count: 2,
                freq: "WEEKLY",
                interval: 1,
              },
            },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-10 Review todo MASTER DAILY/1 until 2026-11-10",
      "2026-11-11 Review todo MASTER WEEKLY/1 WE x2",
      "2026-11-18 Review todo in 2026-11-11",
      "inbox Review todo alone",
    ]);
  });

  test("leaves inbox occurrences alone when the rest of their series goes", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          // Deleting a master "following", and a master with no dated
          // occurrence left to take its role.
          yield* u.create("2026-11-09", daily(5));
          yield* u.update("2026-11-11", { startDate: null }, "this");
          yield* u.remove("2026-11-09", "following");
          yield* u.create("2026-11-20", daily(2));
          yield* u.update("2026-11-21", { startDate: null }, "this");
          yield* u.remove("2026-11-20", "this");
        })
      )
    ).toEqual(["inbox Review todo alone", "inbox Review todo alone"]);
  });

  test("makes an inbox master a series of its own, handing its role on", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(3));
          yield* u.update("2026-11-09", { startDate: null }, "this");
          yield* u.update(
            null,
            { recurrence: daily(2), startDate: "2026-11-20" },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-10 Review todo MASTER DAILY/1 x2",
      "2026-11-11 Review todo in 2026-11-10",
      "2026-11-20 Review todo MASTER DAILY/1 x2",
      "2026-11-21 Review todo in 2026-11-20",
    ]);
  });

  test("takes an inbox occurrence out of its series on Repeat: None", async () => {
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(3));
          yield* u.update("2026-11-10", { startDate: null }, "this");
          yield* u.update(null, { recurrence: null }, "following");
        })
      )
    ).toEqual([
      "2026-11-09 Review todo MASTER DAILY/1 x3",
      "2026-11-11 Review todo in 2026-11-09",
      "inbox Review todo alone",
    ]);
  });

  test("leaves an inbox occurrence alone when a series splits before its moved master", async () => {
    // Daily x5; Nov 12 moved to the inbox; the Nov 9 master moved alone to
    // Nov 20; Nov 10 takes Wednesdays x2 from there on.
    expect(
      await scenario((u) =>
        Effect.gen(function* () {
          yield* u.create("2026-11-09", daily(5));
          yield* u.update("2026-11-12", { startDate: null }, "this");
          yield* u.update("2026-11-09", { startDate: "2026-11-20" }, "this");
          yield* u.update(
            "2026-11-10",
            {
              recurrence: {
                byDay: ["WE"],
                count: 2,
                freq: "WEEKLY",
                interval: 1,
              },
            },
            "following"
          );
        })
      )
    ).toEqual([
      "2026-11-10 Review todo MASTER WEEKLY/1 WE x2",
      "2026-11-11 Review todo in 2026-11-10",
      "2026-11-20 Review todo exc in 2026-11-10",
      "inbox Review todo alone",
    ]);
  });
});
