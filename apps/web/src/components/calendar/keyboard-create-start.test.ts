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

  test("in the hour the clocks repeat, the next half hour of that same hour", () => {
    // 1:10 AM in the second 1 AM (EST), as the clocks fall back.
    const repeated = Temporal.ZonedDateTime.from(
      "2026-11-01T01:10-05:00[America/New_York]"
    );
    const created = keyboardCreateStart({
      now: repeated,
      visibleDays: [Temporal.PlainDate.from("2026-11-01")],
    });
    expect(created.toString()).toBe(
      "2026-11-01T01:30:00-05:00[America/New_York]"
    );
  });

  test("9 AM tomorrow once today has no half hour left", () => {
    expect(start("23:30:40")).toBe("2026-11-10T09:00:00");
  });

  test("9 AM on the first visible day when today isn't shown", () => {
    const later = week.map((day) => day.add({ weeks: 1 }));
    expect(start("09:10", later)).toBe("2026-11-15T09:00:00");
  });
});
