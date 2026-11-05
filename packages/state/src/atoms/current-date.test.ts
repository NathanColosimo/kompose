import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { monthWindows } from "./current-date";

const timeZone = "America/New_York";

describe("monthWindows", () => {
  test("covers each touched month, from midnight on the 1st to the next 1st", () => {
    expect(
      monthWindows(
        Temporal.PlainDate.from("2026-10-25"),
        Temporal.PlainDate.from("2026-11-08"),
        timeZone
      )
    ).toEqual([
      { timeMax: "2026-11-01T04:00:00Z", timeMin: "2026-10-01T04:00:00Z" },
      // November starts in EDT and ends in EST.
      { timeMax: "2026-12-01T05:00:00Z", timeMin: "2026-11-01T04:00:00Z" },
    ]);
  });

  test("paging one view either way stays inside the loaded months", () => {
    const months = (start: Temporal.PlainDate, end: Temporal.PlainDate) =>
      monthWindows(start, end, timeZone).map(({ timeMin }) => timeMin);
    for (let day = 0; day < 366; day += 1) {
      const start = Temporal.PlainDate.from("2026-01-01").add({ days: day });
      for (let count = 1; count <= 7; count += 1) {
        // What eventWindowsAtom loads for this view: the visible days ±7.
        const loaded = new Set(
          months(
            start.subtract({ days: 7 }),
            start.add({ days: count - 1 + 7 })
          )
        );
        for (const pageStart of [
          start.subtract({ days: count }),
          start.add({ days: count }),
        ]) {
          const page = months(pageStart, pageStart.add({ days: count - 1 }));
          expect(page.every((month) => loaded.has(month))).toBe(true);
        }
      }
    }
  });
});
