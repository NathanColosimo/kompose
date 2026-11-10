import { expect, mock, test } from "bun:test";
import type { TaskSelect } from "@kompose/db/schema/task";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer } from "effect";

// Exercise the real service against an in-memory database boundary.
class MemoryDatabase extends Context.Service<MemoryDatabase, unknown>()(
  "Database"
) {}
mock.module("@kompose/db", () => ({
  Database: MemoryDatabase,
  DatabaseLive: Layer.empty,
}));
const { Database } = await import("@kompose/db");
const { TaskService } = await import("./client");

const occurrence = (
  id: string,
  startDate: string,
  status: TaskSelect["status"]
): TaskSelect => ({
  createdAt: "2026-11-10T00:00:00Z",
  description: null,
  dueDate: null,
  durationMinutes: 30,
  id,
  isException: false,
  links: [],
  recurrence: id === "first" ? { freq: "DAILY", interval: 1, count: 3 } : null,
  seriesMasterId: "first",
  startDate,
  startTime: "09:00:00",
  status,
  title: "Before",
  updatedAt: "2026-11-10T00:00:00Z",
  userId: "user",
});

async function saveFollowing(
  regenerate: boolean,
  status: "todo" | "done" = "done"
) {
  let rows = [
    occurrence("first", "2026-11-10", status === "done" ? "todo" : "done"),
    occurrence("second", "2026-11-11", "todo"),
    occurrence("third", "2026-11-12", "done"),
  ];
  const matching = (condition: SQL) => {
    const [id, userId, date, isException] = new PgDialect().sqlToQuery(
      condition
    ).params;
    return rows.filter(
      (row) =>
        row.userId === userId &&
        (date === undefined
          ? row.id === id
          : row.seriesMasterId === id &&
            row.startDate !== null &&
            row.startDate >= String(date) &&
            (isException === undefined || row.isException === isException))
    );
  };
  const db = {
    select: () => ({
      from: () => ({
        where: (condition: SQL) => {
          const selected = Effect.sync(() => matching(condition));
          return Object.assign(selected, { orderBy: () => selected });
        },
      }),
    }),
    update: () => ({
      set: (input: Partial<TaskSelect>) => ({
        where: (condition: SQL) => ({
          returning: () =>
            Effect.sync(() => {
              const ids = new Set(matching(condition).map((row) => row.id));
              rows = rows.map((row) =>
                ids.has(row.id) ? { ...row, ...input } : row
              );
              return rows.filter((row) => ids.has(row.id));
            }),
        }),
      }),
    }),
    delete: () => ({
      where: (condition: SQL) =>
        Effect.sync(() => {
          const ids = new Set(matching(condition).map((row) => row.id));
          rows = rows.filter((row) => !ids.has(row.id));
        }),
    }),
    insert: () => ({
      values: (input: TaskSelect[]) => ({
        returning: () =>
          Effect.sync(() => {
            rows.push(...input);
            return input;
          }),
      }),
    }),
    query: {
      taskTable: {
        findMany: ({
          where,
        }: {
          where: { id: { in: string[] }; userId: string };
        }) =>
          Effect.sync(() =>
            rows
              .filter(
                (row) =>
                  where.id.in.includes(row.id) && row.userId === where.userId
              )
              .map((row) => ({ ...row, tags: [] }))
          ),
      },
    },
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* TaskService.make;
      yield* service.updateTask(
        "user",
        "first",
        {
          ...(regenerate
            ? { recurrence: { freq: "DAILY", interval: 2, count: 3 } }
            : {}),
          status,
          title: "After",
        },
        "following"
      );
    }).pipe(
      // The fake implements only the Drizzle operations used by these service paths.
      Effect.provideService(
        Database,
        db as unknown as Context.Service.Shape<typeof Database>
      )
    )
  );
  return rows;
}

test("Mark done with following edits changes only the selected occurrence's status", async () => {
  const rows = await saveFollowing(false);
  expect(rows.map((row) => row.title)).toEqual(["After", "After", "After"]);
  expect(rows.map((row) => row.status)).toEqual(["done", "todo", "done"]);
});

test("Mark done with a new pattern completes only the selected replacement", async () => {
  const rows = await saveFollowing(true);
  expect(rows.map((row) => row.startDate)).toEqual([
    "2026-11-10",
    "2026-11-12",
    "2026-11-14",
  ]);
  expect(rows.map((row) => row.status)).toEqual(["done", "todo", "todo"]);
});

test("Mark todo with following edits leaves future completed occurrences done", async () => {
  const rows = await saveFollowing(false, "todo");
  expect(rows.map((row) => row.status)).toEqual(["todo", "todo", "done"]);
});
