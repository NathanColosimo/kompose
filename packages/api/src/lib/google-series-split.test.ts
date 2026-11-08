import { describe, expect, test } from "bun:test";
import {
  truncateRecurrenceForFollowing,
  withRemainingCount,
} from "@kompose/google-cal/recurrence-utils";

describe("splitting a series", () => {
  test("ends an all-day series the day before, as a date", () => {
    expect(
      truncateRecurrenceForFollowing(
        ["EXDATE;VALUE=DATE:20261103", "RRULE:FREQ=DAILY;COUNT=10"],
        "2026-11-10"
      )
    ).toEqual([
      "EXDATE;VALUE=DATE:20261103",
      "RRULE:FREQ=DAILY;UNTIL=20261109",
    ]);
  });

  test("ends a timed series the second before, in UTC", () => {
    expect(
      truncateRecurrenceForFollowing(
        ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270101T000000Z"],
        "2026-11-10T09:00:00-05:00"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261110T135959Z"]);
  });

  test("carries on a kept COUNT from where the series is cut", () => {
    // A five-time series split at its third: three left.
    expect(withRemainingCount(["RRULE:FREQ=DAILY;COUNT=5"], 2)).toEqual([
      "RRULE:FREQ=DAILY;COUNT=3",
    ]);
    expect(withRemainingCount(["RRULE:COUNT=5;FREQ=DAILY"], 2)).toEqual([
      "RRULE:COUNT=3;FREQ=DAILY",
    ]);
    expect(withRemainingCount(["RRULE:FREQ=DAILY"], 2)).toEqual([
      "RRULE:FREQ=DAILY",
    ]);
  });
});
