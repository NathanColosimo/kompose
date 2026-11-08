/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { keyboardCreateStart } from "./keyboard-create-start";

const zone = "America/New_York";
const now = (time: string) =>
  Temporal.PlainDateTime.from(`2026-11-09T${time}`).toZonedDateTime(zone);
const week = Array.from({ length: 7 }, (_, i) =>
  Temporal.PlainDate.from("2026-11-08").add({ days: i })
);
const start = (time: string, days = week) =>
  keyboardCreateStart({ now: now(time), visibleDays: days })
    .toPlainDateTime()
    .toString();

describe("keyboardCreateStart", () => {
  test("the next half hour today, never one already started", () => {
    expect(start("09:30")).toBe("2026-11-09T09:30:00");
    expect(start("09:30:40")).toBe("2026-11-09T10:00:00");
    expect(start("09:10")).toBe("2026-11-09T09:30:00");
  });

  test("never a time the editor would save as an earlier moment", () => {
    // The form keeps a date and an "HH:mm", and a wall time the clocks
    // repeat saves as its first occurrence: the second 1:30 AM as the
    // clocks fall back would save 40 minutes in the past.
    const created = (at: string) =>
      keyboardCreateStart({
        now: Temporal.ZonedDateTime.from(at),
        visibleDays: [Temporal.PlainDate.from("2026-11-01")],
      });
    const savesAs = (time: Temporal.ZonedDateTime) =>
      time.toPlainDateTime().toZonedDateTime(time.timeZoneId);
    for (const [at, expected] of [
      // The first 1 AM saves as itself.
      ["2026-11-01T00:50-04:00", "2026-11-01T01:00:00-04:00"],
      ["2026-11-01T01:10-04:00", "2026-11-01T01:30:00-04:00"],
      // The second one doesn't: start after it.
      ["2026-11-01T01:10-05:00", "2026-11-01T02:00:00-05:00"],
    ] as const) {
      const begins = created(`${at}[America/New_York]`);
      expect(begins.toString()).toBe(`${expected}[America/New_York]`);
      expect(savesAs(begins).equals(begins)).toBe(true);
    }
  });

  test("9 AM tomorrow once today has no half hour left", () => {
    expect(start("23:30:40")).toBe("2026-11-10T09:00:00");
  });

  test("9 AM on the first visible day when today isn't shown", () => {
    const later = week.map((day) => day.add({ weeks: 1 }));
    expect(start("09:10", later)).toBe("2026-11-15T09:00:00");
  });
});
