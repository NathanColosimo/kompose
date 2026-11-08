import { describe, expect, test } from "bun:test";
import {
  matchRecurrenceToStart,
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

describe("matchRecurrenceToStart", () => {
  const zone = "America/New_York";
  const allDay = { date: "2026-11-07" };
  const timed = { dateTime: "2026-11-07T09:00:00-05:00" };

  test("gives an UNTIL the form its series' start takes", () => {
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z"],
        allDay,
        zone
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261205"]);
    expect(
      matchRecurrenceToStart(["RRULE:FREQ=WEEKLY;UNTIL=20261205"], timed, zone)
    ).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z"]);
    const same = ["RRULE:FREQ=WEEKLY;UNTIL=20261205"];
    expect(matchRecurrenceToStart(same, allDay, zone)).toBe(same);
  });

  test("keeps a skipped occurrence skipped in the new form", () => {
    // Made all day: the skipped 9:00 (UTC 14:00) becomes its date.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY", "EXDATE:20261128T140000Z"],
        allDay,
        zone
      )
    ).toEqual(["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261128"]);
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY", "EXDATE;TZID=America/New_York:20261128T090000"],
        allDay,
        zone
      )
    ).toEqual(["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261128"]);
    // Made timed: the skipped date becomes that day at the series' time.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261128,20261205"],
        timed,
        zone
      )
    ).toEqual([
      "RRULE:FREQ=WEEKLY",
      "EXDATE;TZID=America/New_York:20261128T090000,20261205T090000",
    ]);
  });
});
