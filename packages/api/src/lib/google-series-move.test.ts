import { describe, expect, test } from "bun:test";
import {
  daysBetweenStarts,
  shiftEventTime,
} from "@kompose/google-cal/recurrence-utils";

describe("moving a series with its occurrence", () => {
  test("counts the days an occurrence moved, by its written date", () => {
    expect(
      daysBetweenStarts(
        { dateTime: "2026-11-10T09:00:00-05:00" },
        { dateTime: "2026-11-11T09:00:00-05:00" }
      )
    ).toBe(1);
    expect(
      daysBetweenStarts({ date: "2026-11-30" }, { date: "2026-12-07" })
    ).toBe(7);
    // A time change alone doesn't move the series.
    expect(
      daysBetweenStarts(
        { dateTime: "2026-11-10T09:00:00-05:00" },
        { dateTime: "2026-11-10T23:30:00-05:00" }
      )
    ).toBe(0);
  });

  test("moves a start's date and keeps its time", () => {
    expect(
      shiftEventTime(
        { dateTime: "2026-01-06T09:00:00-05:00", timeZone: "America/New_York" },
        1
      )
    ).toEqual({
      dateTime: "2026-01-07T09:00:00-05:00",
      timeZone: "America/New_York",
    });
    expect(shiftEventTime({ date: "2026-12-29" }, 7)).toEqual({
      date: "2027-01-05",
    });
  });
});
