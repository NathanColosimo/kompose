import { describe, expect, test } from "bun:test";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import { mergeSavedTasks } from "./task-cache";

const row = (
  id: string,
  date: string,
  extra: Partial<TaskSelectDecoded> = {}
): TaskSelectDecoded =>
  ({
    id,
    isException: false,
    seriesMasterId: "old",
    startDate: Temporal.PlainDate.from(date),
    status: "todo",
    title: "Weekly review",
    ...extra,
  }) as TaskSelectDecoded;

const ids = (tasks: TaskSelectDecoded[]) =>
  tasks.map((task) => `${task.id}:${task.status}`);

describe("mergeSavedTasks", () => {
  const cached = [
    row("nov2", "2026-11-02"),
    row("nov9", "2026-11-09"),
    row("nov16", "2026-11-16"),
    row("nov23", "2026-11-23", { isException: true }),
    row("other", "2026-11-10", { seriesMasterId: null }),
  ];

  test("replaces a this-occurrence save in place", () => {
    const saved = [row("nov9", "2026-11-09", { status: "done" })];
    expect(
      ids(
        mergeSavedTasks(cached, saved, { id: "nov9", scope: "this", task: {} })
      )
    ).toEqual([
      "nov2:todo",
      "nov9:done",
      "nov16:todo",
      "nov23:todo",
      "other:todo",
    ]);
  });

  test("swaps a pattern change's replaced occurrences for the new ones", () => {
    const saved = [
      row("nov9", "2026-11-09", { isException: true, status: "done" }),
      row("nov10", "2026-11-10", { seriesMasterId: "new" }),
      row("nov17", "2026-11-17", { seriesMasterId: "new" }),
    ];
    // Nov 16 was replaced; Nov 23 is an exception and stays; Nov 2 is before.
    expect(
      ids(
        mergeSavedTasks(cached, saved, {
          id: "nov9",
          scope: "following",
          task: { recurrence: { freq: "DAILY", interval: 1 } },
        })
      )
    ).toEqual([
      "nov2:todo",
      "nov9:done",
      "nov23:todo",
      "other:todo",
      "nov10:todo",
      "nov17:todo",
    ]);
  });

  test("drops replaced occurrences from the moved date when it's earlier", () => {
    // Nov 16 moved to Nov 9 with a new pattern: the server split the series
    // at Nov 9, so the cached Nov 9 goes too.
    const saved = [
      row("new9", "2026-11-09", { seriesMasterId: "new" }),
      row("new16", "2026-11-16", { seriesMasterId: "new" }),
    ];
    expect(
      ids(
        mergeSavedTasks(cached, saved, {
          id: "nov16",
          scope: "following",
          task: {
            recurrence: {
              count: 2,
              freq: "WEEKLY",
              byDay: ["MO"],
              interval: 1,
            },
            startDate: Temporal.PlainDate.from("2026-11-09"),
          },
        })
      )
    ).toEqual([
      "nov2:todo",
      "nov23:todo",
      "other:todo",
      "new9:todo",
      "new16:todo",
    ]);
  });

  test("keeps the rows before a move when the pattern sent is unchanged", () => {
    // Every 2 days x2 from Nov 9; Nov 11 moved to Nov 8, "following", with
    // the series' pattern sent along: the server shifts Nov 11 alone and
    // keeps the Nov 9 master.
    const pattern = { count: 2, freq: "DAILY" as const, interval: 2 };
    const series = [
      row("nov9", "2026-11-09", {
        recurrence: pattern,
        seriesMasterId: "nov9",
      }),
      row("nov11", "2026-11-11", { seriesMasterId: "nov9" }),
    ];
    const saved = [row("nov11", "2026-11-08", { seriesMasterId: "nov9" })];
    expect(
      ids(
        mergeSavedTasks(series, saved, {
          id: "nov11",
          scope: "following",
          task: {
            recurrence: { freq: "DAILY", interval: 2, count: 2 },
            startDate: Temporal.PlainDate.from("2026-11-08"),
          },
        })
      )
    ).toEqual(["nov9:todo", "nov11:todo"]);
  });

  test("splits for a count change even when the pattern also has an end date", () => {
    // Daily x4 until Nov 30 from Nov 9; Nov 11 moved to Nov 8 with x2: the
    // server replaces Nov 9-12 with Nov 8 and 9.
    const until = { freq: "DAILY" as const, interval: 1, until: "2026-11-30" };
    const series = [
      row("nov9", "2026-11-09", {
        recurrence: { ...until, count: 4 },
        seriesMasterId: "nov9",
      }),
      row("nov10", "2026-11-10", { seriesMasterId: "nov9" }),
      row("nov11", "2026-11-11", { seriesMasterId: "nov9" }),
      row("nov12", "2026-11-12", { seriesMasterId: "nov9" }),
    ];
    const saved = [
      row("new8", "2026-11-08", { seriesMasterId: "new8" }),
      row("new9", "2026-11-09", { seriesMasterId: "new8" }),
    ];
    expect(
      ids(
        mergeSavedTasks(series, saved, {
          id: "nov11",
          scope: "following",
          task: {
            recurrence: { ...until, count: 2 },
            startDate: Temporal.PlainDate.from("2026-11-08"),
          },
        })
      )
    ).toEqual(["new8:todo", "new9:todo"]);
  });
});
