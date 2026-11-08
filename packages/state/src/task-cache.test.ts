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
      ids(mergeSavedTasks(cached, saved, { id: "nov9", scope: "this" }))
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
      ids(mergeSavedTasks(cached, saved, { id: "nov9", scope: "following" }))
    ).toEqual([
      "nov2:todo",
      "nov9:done",
      "nov23:todo",
      "other:todo",
      "nov10:todo",
      "nov17:todo",
    ]);
  });
});
