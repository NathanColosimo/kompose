import { describe, expect, test } from "bun:test";
import {
  matchUntilToStart,
  untilRuleForDay,
  untilRuleToDay,
} from "@kompose/google-cal/until";
import { Temporal } from "temporal-polyfill";

const day = (iso: string) => Temporal.PlainDate.from(iso);

describe("untilRuleForDay", () => {
  const zone = "America/New_York";
  test("ends after the picked day's occurrence, in the event's zone", () => {
    expect(untilRuleForDay(day("2026-12-05"), true, zone)).toBe("20261205");
    // The day's last second in New York, in UTC.
    expect(untilRuleForDay(day("2026-12-05"), false, zone)).toBe(
      "20261206T045959Z"
    );
    expect(untilRuleForDay(day("2027-03-14"), false, zone)).toBe(
      "20270315T035959Z"
    );
    expect(untilRuleForDay(day("2026-12-05"), false, "Asia/Tokyo")).toBe(
      "20261205T145959Z"
    );
  });

  test("reads back as the same day", () => {
    for (const allDay of [true, false]) {
      expect(
        untilRuleToDay(
          untilRuleForDay(day("2026-12-05"), allDay, zone),
          zone
        )?.toString()
      ).toBe("2026-12-05");
    }
  });
});

describe("matchUntilToStart", () => {
  const zone = "America/New_York";
  test("gives an UNTIL the form its series' start takes", () => {
    expect(
      matchUntilToStart(
        ["RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z"],
        true,
        zone
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261205"]);
    expect(
      matchUntilToStart(
        ["RRULE:FREQ=WEEKLY;UNTIL=20261205", "EXDATE:20261128"],
        false,
        zone
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z", "EXDATE:20261128"]);
    const same = ["RRULE:FREQ=WEEKLY;UNTIL=20261205"];
    expect(matchUntilToStart(same, true, zone)).toBe(same);
  });
});
