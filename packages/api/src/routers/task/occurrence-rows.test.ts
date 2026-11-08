/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { TaskSelect } from "@kompose/db/schema/task";
import {
  endedBefore,
  heirPattern,
  keepsEditedOccurrence,
  regeneratedOccurrenceRows,
  withMovedDueDate,
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
  test("leaves the pattern to a kept edited occurrence, the master", () => {
    const rowsKept = regeneratedOccurrenceRows({
      input: { recurrence: tuesdays },
      keepEdited: true,
      keptDates: new Set(["2026-11-09"]),
      seriesMasterId: "nov9",
      task: nov9,
      userId: "user",
    });
    expect(rowsKept.every((r) => r.seriesMasterId === "nov9")).toBe(true);
    expect(rowsKept.every((r) => r.recurrence === null)).toBe(true);
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

describe("heirPattern", () => {
  test("counts the occurrences left for the next master", () => {
    const daily4 = { count: 4, freq: "DAILY" as const, interval: 1 };
    // Nov 9 (master) deleted, Nov 10 deleted earlier: Nov 11 and 12 left.
    expect(heirPattern(daily4, 2)).toEqual({ ...daily4, count: 2 });
    const open = { freq: "DAILY" as const, interval: 1 };
    expect(heirPattern(open, 2)).toEqual(open);
  });
});

describe("endedBefore", () => {
  test("never ends past the last occurrence or the pattern's own end", () => {
    const daily = { freq: "DAILY" as const, interval: 1 };
    // Master moved to Nov 20; Nov 10-12 are what's left.
    expect(endedBefore(daily, "2026-11-20", "2026-11-12")).toEqual({
      ...daily,
      until: "2026-11-12",
    });
    expect(
      endedBefore({ ...daily, until: "2026-11-11" }, "2026-11-20", "2026-11-12")
    ).toEqual({ ...daily, until: "2026-11-11" });
  });

  test("stops a pattern the day before, dropping its count", () => {
    expect(
      endedBefore({ count: 4, freq: "DAILY", interval: 1 }, "2026-11-13")
    ).toEqual({ freq: "DAILY", interval: 1, until: "2026-11-12" });
  });
});

describe("withMovedDueDate", () => {
  // Nov 9, due Nov 10.
  const due = { ...nov9, dueDate: "2026-11-10" };

  test("moves the due date with the task when the edit leaves it", () => {
    expect(withMovedDueDate(due, { startDate: "2026-11-13" }).dueDate).toBe(
      "2026-11-14"
    );
    // Editors send every field: the same due date counts as left alone.
    expect(
      withMovedDueDate(due, {
        dueDate: "2026-11-10",
        startDate: "2026-11-13",
      }).dueDate
    ).toBe("2026-11-14");
  });

  test("keeps a due date the edit sets or clears", () => {
    const moved = { startDate: "2026-11-13" };
    expect(
      withMovedDueDate(due, { ...moved, dueDate: "2026-11-20" }).dueDate
    ).toBe("2026-11-20");
    expect(withMovedDueDate(due, { ...moved, dueDate: null }).dueDate).toBe(
      null
    );
  });

  test("gives the series the moved task's offset", () => {
    // Nov 9 due Nov 10, moved to Nov 13 with every 2 days x3: each is due
    // the day after, as before the move.
    const input = withMovedDueDate(due, {
      recurrence: { count: 3, freq: "DAILY", interval: 2 },
      startDate: "2026-11-13",
    });
    expect(
      regeneratedOccurrenceRows({
        input: {
          ...input,
          recurrence: { count: 3, freq: "DAILY", interval: 2 },
        },
        keepEdited: false,
        keptDates: new Set(),
        seriesMasterId: "new-master",
        task: due,
        userId: "user",
      }).map((r) => `${r.startDate}>${r.dueDate}`)
    ).toEqual([
      "2026-11-13>2026-11-14",
      "2026-11-15>2026-11-16",
      "2026-11-17>2026-11-18",
    ]);
  });
});
