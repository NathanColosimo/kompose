import { describe, expect, test } from "bun:test";
import {
  rulePositionsBefore,
  splitAddedDays,
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

  test("cuts a rule written COUNT-first without an empty part", () => {
    expect(
      truncateRecurrenceForFollowing(
        ["RRULE:COUNT=5;FREQ=DAILY"],
        "2026-11-10T09:00:00-05:00"
      )
    ).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261110T135959Z"]);
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

  test("gives each part its own added days", () => {
    const rule = ["RRULE:FREQ=WEEKLY", "RDATE;VALUE=DATE:20261101,20261109"];
    // The old part ends before Nov 3: Nov 9 isn't its any more.
    expect(
      truncateRecurrenceForFollowing(rule, "2026-11-03", "America/New_York")
    ).toEqual([
      "RRULE:FREQ=WEEKLY;UNTIL=20261102",
      "RDATE;VALUE=DATE:20261101",
    ]);
    expect(
      splitAddedDays(rule, "2026-11-03", "America/New_York", "from")
    ).toEqual(["RRULE:FREQ=WEEKLY", "RDATE;VALUE=DATE:20261109"]);
  });

  test("counts rule positions, skipped ones in, added ones out", () => {
    // Daily COUNT=5 from Nov 1, Nov 2 skipped, split at Nov 3: Google lists
    // Nov 1 only, but two positions are used.
    expect(
      rulePositionsBefore(
        1,
        ["RRULE:FREQ=DAILY;COUNT=5", "EXDATE;VALUE=DATE:20261102"],
        "2026-11-03",
        "America/New_York"
      )
    ).toBe(2);
    expect(
      rulePositionsBefore(
        3,
        ["RRULE:FREQ=DAILY;COUNT=5", "RDATE;VALUE=DATE:20261031"],
        "2026-11-03",
        "America/New_York"
      )
    ).toBe(2);
  });
});
