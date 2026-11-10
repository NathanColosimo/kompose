import { describe, expect, test } from "bun:test";
import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import { Temporal } from "temporal-polyfill";
import { isInboxTask, isListedAlone } from "./task-search-routing";

// Only the fields these checks read; the rest don't affect them.
const task = (extra: Partial<TaskSelectDecoded>): TaskSelectDecoded =>
  ({
    seriesMasterId: null,
    startDate: null,
    status: "todo",
    ...extra,
  }) as TaskSelectDecoded;

describe("isListedAlone / isInboxTask", () => {
  const nov9 = Temporal.PlainDate.from("2026-11-09");

  test("lists a series occurrence moved to the inbox like any inbox task", () => {
    const moved = task({ seriesMasterId: "master" });
    expect(isListedAlone(moved)).toBe(true);
    expect(isInboxTask(moved)).toBe(true);
  });

  test("leaves a series' dated occurrences to the calendar", () => {
    const dated = task({ seriesMasterId: "master", startDate: nov9 });
    expect(isListedAlone(dated)).toBe(false);
    expect(isInboxTask(dated)).toBe(false);
  });

  test("lists a task that doesn't repeat", () => {
    expect(isListedAlone(task({ startDate: nov9 }))).toBe(true);
  });
});
