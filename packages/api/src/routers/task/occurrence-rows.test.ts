/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { TaskSelect } from "@kompose/db/schema/task";
import {
  heirPattern,
  keepsEditedOccurrence,
  regeneratedOccurrenceRows,
  repeatEndsBeforeStart,
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
    masterIsKept: keepEdited,
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
  test("leaves the pattern to a kept edited occurrence, the master", () => {
    const rowsKept = regeneratedOccurrenceRows({
      input: { recurrence: tuesdays },
      keepEdited: true,
      masterIsKept: true,
      keptDates: new Set(["2026-11-09"]),
      seriesMasterId: "nov9",
      task: nov9,
      userId: "user",
    });
    expect(rowsKept.every((r) => r.seriesMasterId === "nov9")).toBe(true);
    expect(rowsKept.every((r) => r.recurrence === null)).toBe(true);
  });

  test("leaves the master role to an exception already on the start", () => {
    // Nov 16 done alone; Nov 9 (ordinary, replaced) moved onto it, Daily x3:
    // Nov 16 is the master (the caller gives it the pattern), 17 and 18 join.
    const rowsOnKept = regeneratedOccurrenceRows({
      input: {
        recurrence: { count: 3, freq: "DAILY", interval: 1 },
        startDate: "2026-11-16",
      },
      keepEdited: false,
      keptDates: new Set(["2026-11-16"]),
      masterIsKept: true,
      seriesMasterId: "nov16",
      task: nov9,
      userId: "user",
    });
    expect(rowsOnKept.map((r) => `${r.startDate} ${r.seriesMasterId}`)).toEqual(
      ["2026-11-17 nov16", "2026-11-18 nov16"]
    );
    expect(rowsOnKept.some((r) => r.id === "nov16" || r.recurrence)).toBe(
      false
    );
  });

  test("starts every new occurrence open, even from a done one", () => {
    // Nov 9 (a Monday, kept) is the first of the four; three are new.
    expect(rows({ recurrence: tuesdays }, true, ["2026-11-09"])).toEqual([
      "2026-11-10 todo",
      "2026-11-17 todo",
      "2026-11-24 todo",
    ]);
  });

  test("leaves out kept dates instead of doubling them", () => {
    expect(rows({ recurrence: monTue }, true, ["2026-11-09"])).toEqual([
      "2026-11-10 todo",
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

  test("measures due dates from the edited task's new start", () => {
    const rowsWithDue = regeneratedOccurrenceRows({
      input: {
        dueDate: "2026-11-11",
        recurrence: tuesdays,
        startDate: "2026-11-10",
      },
      keepEdited: true,
      masterIsKept: true,
      keptDates: new Set(["2026-11-10"]),
      seriesMasterId: "new-master",
      task: nov9,
      userId: "user",
    });
    expect(rowsWithDue.map((r) => `${r.startDate}>${r.dueDate}`)).toEqual([
      "2026-11-17>2026-11-18",
      "2026-11-24>2026-11-25",
      "2026-12-01>2026-12-02",
    ]);
  });

  test("keeps a field the edit clears cleared", () => {
    const [first] = regeneratedOccurrenceRows({
      input: { dueDate: null, recurrence: tuesdays, startTime: null },
      keepEdited: true,
      masterIsKept: true,
      keptDates: new Set(["2026-11-09"]),
      seriesMasterId: "new-master",
      task: { ...nov9, dueDate: "2026-11-11" },
      userId: "user",
    });
    expect(first?.dueDate).toBeNull();
    expect(first?.startTime).toBeNull();
  });

  test("keeps a moved occurrence the new pattern wouldn't land on", () => {
    // Moved to Tuesday Nov 10, every 2 weeks on Monday: Nov 10 stays first.
    expect(
      rows(
        {
          recurrence: { ...tuesdays, byDay: ["MO"], count: 3, interval: 2 },
          startDate: "2026-11-10",
        },
        false
      )
    ).toEqual(["2026-11-10 done R", "2026-11-23 todo", "2026-12-07 todo"]);
  });

  test("starts the new pattern where the edit moves the occurrence", () => {
    // Moved to Nov 12 with Daily x3, nothing else: the series is Nov 12-14,
    // the moved occurrence first, keeping its status.
    expect(
      rows(
        {
          recurrence: { count: 3, freq: "DAILY", interval: 1 },
          startDate: "2026-11-12",
        },
        false
      )
    ).toEqual(["2026-11-12 done R", "2026-11-13 todo", "2026-11-14 todo"]);
    // Moved to Nov 23 and kept there (Mark done): the series follows it.
    expect(
      rows({ recurrence: tuesdays, startDate: "2026-11-23" }, true, [
        "2026-11-23",
      ])
    ).toEqual(["2026-11-24 todo", "2026-12-01 todo", "2026-12-08 todo"]);
  });
});

describe("repeatEndsBeforeStart", () => {
  test("flags a repeat that ends before the task starts", () => {
    const daily = { freq: "DAILY" as const, interval: 1 };
    expect(
      repeatEndsBeforeStart({ ...daily, until: "2026-11-11" }, "2026-11-12")
    ).toBe(true);
    expect(
      repeatEndsBeforeStart({ ...daily, until: "2026-11-12" }, "2026-11-12")
    ).toBe(false);
    expect(repeatEndsBeforeStart(daily, "2026-11-12")).toBe(false);
  });
});

describe("heirPattern", () => {
  test("counts the occurrences left for the next master", () => {
    const daily4 = { count: 4, freq: "DAILY" as const, interval: 1 };
    // Nov 9 (master) deleted, Nov 10 deleted earlier: Nov 11 and 12 left.
    expect(heirPattern(daily4, 2)).toEqual({ ...daily4, count: 2 });
    const open = { freq: "DAILY" as const, interval: 1 };
    expect(heirPattern(open, 2)).toEqual(open);
  });
});
