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
      create: (startDate: string, recurrence: TaskRecurrence) =>
        service.createTask(userId, {
          recurrence,
          startDate,
          title: "Review",
          userId,
        }),
      remove: (date: string | null, scope: DeleteScope) =>
        Effect.flatMap(find(date), (task) =>
          service.deleteTask(userId, task.id, scope)
        ),
      update: (date: string, input: TaskUpdateInput, scope: UpdateScope) =>
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
});
