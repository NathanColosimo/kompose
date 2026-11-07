/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { TaskSelect } from "@kompose/db/schema/task";
import {
  keepsEditedOccurrence,
  regeneratedOccurrenceRows,
} from "./occurrence-rows";

// Nov 9, an occurrence of a Mondays series.
const nov9: TaskSelect & { startDate: string } = {
  createdAt: "2026-11-01T00:00:00Z",
  description: null,
  dueDate: null,
  durationMinutes: 30,
  id: "nov9",
  isException: false,
  links: [],
  recurrence: null,
  seriesMasterId: "master",
  startDate: "2026-11-09",
  startTime: "09:00:00",
  status: "done",
  title: "Weekly review",
  updatedAt: "2026-11-01T00:00:00Z",
  userId: "user",
};
const tuesdays = {
  byDay: ["TU" as const],
  count: 4,
  freq: "WEEKLY" as const,
  interval: 1,
};
const monTue = { ...tuesdays, byDay: ["MO" as const, "TU" as const] };

const rows = (
  input: Parameters<typeof regeneratedOccurrenceRows>[0]["input"],
  keepEdited: boolean,
  keptDates: string[] = []
) =>
  regeneratedOccurrenceRows({
    input,
    keepEdited,
    keptDates: new Set(keptDates),
    seriesMasterId: "new-master",
    task: nov9,
    userId: "user",
  }).map(
    (row) => `${row.startDate} ${row.status}${row.recurrence ? " R" : ""}`
  );

describe("keepsEditedOccurrence", () => {
  test("keeps an exception, or one whose status the edit sets", () => {
    expect(keepsEditedOccurrence({ isException: true }, {})).toBe(true);
    expect(
      keepsEditedOccurrence({ isException: false }, { status: "done" })
    ).toBe(true);
    expect(keepsEditedOccurrence({ isException: false }, {})).toBe(false);
  });
});

describe("regeneratedOccurrenceRows", () => {
  test("starts every new occurrence open, even from a done one", () => {
    expect(rows({ recurrence: tuesdays }, true, ["2026-11-09"])).toEqual([
      "2026-11-10 todo R",
      "2026-11-17 todo",
      "2026-11-24 todo",
      "2026-12-01 todo",
    ]);
  });

  test("leaves out kept dates instead of doubling them", () => {
    expect(rows({ recurrence: monTue }, true, ["2026-11-09"])).toEqual([
      "2026-11-10 todo R",
      "2026-11-16 todo",
      "2026-11-17 todo",
    ]);
  });

  test("keeps a replaced occurrence's status on its own date", () => {
    expect(rows({ recurrence: monTue }, false)).toEqual([
      "2026-11-09 done R",
      "2026-11-10 todo",
      "2026-11-16 todo",
      "2026-11-17 todo",
    ]);
  });

  test("regenerates from the original date when the edit moves it", () => {
    // Moved to Nov 23 (kept there); the series still starts after Nov 9.
    expect(
      rows({ recurrence: tuesdays, startDate: "2026-11-23" }, true, [
        "2026-11-23",
      ])
    ).toEqual([
      "2026-11-10 todo R",
      "2026-11-17 todo",
      "2026-11-24 todo",
      "2026-12-01 todo",
    ]);
  });
});
