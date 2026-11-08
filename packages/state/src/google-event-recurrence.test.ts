import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  buildGoogleEventRecurrenceRule,
  type EventRecurrencePattern,
  followStart,
  getPrimaryRecurrenceRule,
  lastWeekdayOf,
  monthlyWeekdayOf,
  parseGoogleEventRecurrenceRule,
  pickRecurrenceFrequency,
  setPrimaryRecurrenceRule,
  untilRuleForDay,
  untilRuleToDay,
} from "./google-event-recurrence";

describe("setPrimaryRecurrenceRule", () => {
  const exdate = "EXDATE;TZID=America/New_York:20261117T090000";
  test("swaps the rule and keeps deleted occurrences", () => {
    expect(
      setPrimaryRecurrenceRule(
        [exdate, "RRULE:FREQ=WEEKLY;BYDAY=TU"],
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", exdate]);
  });

  test("clears every line when the repeat ends", () => {
    expect(
      setPrimaryRecurrenceRule(["RRULE:FREQ=DAILY", exdate], null)
    ).toEqual([]);
  });

  test("finds the rule wherever Google lists it", () => {
    expect(getPrimaryRecurrenceRule([exdate, "RRULE:FREQ=DAILY"])).toBe(
      "RRULE:FREQ=DAILY"
    );
  });
});

describe("buildGoogleEventRecurrenceRule", () => {
  /** Parse `rule`, apply an edit, and build it back, as the editors do. */
  const edit = (
    rule: string,
    change: (pattern: EventRecurrencePattern) => EventRecurrencePattern
  ) =>
    buildGoogleEventRecurrenceRule(
      change(parseGoogleEventRecurrenceRule(rule)),
      rule
    );
  const endAfter5 = (pattern: EventRecurrencePattern) => ({
    ...pattern,
    end: { count: 5, type: "count" } as const,
  });

  test("keeps the parts an edit doesn't set", () => {
    // "Ends after 5" on an every-2-weeks series stays every 2 weeks.
    for (const [rule, expected] of [
      [
        "RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=TU",
        "RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=TU;COUNT=5",
      ],
      ["RRULE:FREQ=YEARLY;INTERVAL=2", "RRULE:FREQ=YEARLY;INTERVAL=2;COUNT=5"],
      [
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=5",
      ],
    ] as const) {
      expect(edit(rule, endAfter5)).toBe(expected);
    }
  });

  test("sets the interval", () => {
    expect(
      edit("RRULE:FREQ=WEEKLY;BYDAY=TU", (p) => ({ ...p, interval: 2 }))
    ).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
    expect(
      edit("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", (p) => ({
        ...p,
        interval: 1,
      }))
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU");
  });

  test("picking a frequency keeps what still applies", () => {
    const pick = (rule: string, to: EventRecurrencePattern["freq"]) =>
      edit(rule, (p) => pickRecurrenceFrequency(p, to));
    // Re-picking the current frequency changes nothing.
    for (const rule of [
      "RRULE:FREQ=MONTHLY;BYDAY=2TU",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
    ]) {
      expect(pick(rule, parseGoogleEventRecurrenceRule(rule).freq)).toBe(rule);
    }
    // "2nd Tuesday" means nothing weekly; it repeats on the start's weekday.
    expect(pick("RRULE:FREQ=MONTHLY;BYDAY=2TU", "WEEKLY")).toBe(
      "RRULE:FREQ=WEEKLY"
    );
    // A new frequency starts at every 1, without the old one's day parts.
    expect(pick("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", "MONTHLY")).toBe(
      "RRULE:FREQ=MONTHLY"
    );
    expect(
      pick("RRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15;WKST=SU", "WEEKLY")
    ).toBe("RRULE:FREQ=WEEKLY;WKST=SU");
  });

  test("Day N drops a BYSETPOS weekday pick", () => {
    expect(
      edit("RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", (p) => ({
        ...p,
        byDay: [],
      }))
    ).toBe("RRULE:FREQ=MONTHLY");
  });

  test("picking the start's day drops the rule's own day of the month", () => {
    expect(
      edit("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1", (p) => ({ ...p, monthDays: [] }))
    ).toBe("RRULE:FREQ=MONTHLY");
  });

  test("a weekday of the month replaces a day of the month", () => {
    expect(
      edit("RRULE:FREQ=MONTHLY;BYMONTHDAY=10", (p) => ({
        ...p,
        byDay: ["2TU"],
      }))
    ).toBe("RRULE:FREQ=MONTHLY;BYDAY=2TU");
  });
});

const day = (iso: string) => Temporal.PlainDate.from(iso);

describe("weekdays of the month", () => {
  test("name the start's, a 5th as the last", () => {
    expect(monthlyWeekdayOf(day("2026-11-10"))).toBe("2TU");
    expect(monthlyWeekdayOf(day("2026-12-29"))).toBe("-1TU");
    // Nov 27, 2026 is the 4th Friday and the last.
    expect(monthlyWeekdayOf(day("2026-11-27"))).toBe("4FR");
    expect(lastWeekdayOf(day("2026-11-27"))).toBe("-1FR");
    expect(lastWeekdayOf(day("2026-11-20"))).toBeNull();
  });
});

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

describe("followStart", () => {
  const zone = "America/New_York";
  const follow = (rule: string, from: string, to: string) =>
    followStart({
      allDay: false,
      from: day(from),
      recurrence: [rule],
      timeZone: zone,
      to: day(to),
    })[0];

  test("moves the start's weekday or day of the month with it", () => {
    // The 2nd Tue (Nov 10) moved to the 3rd Wed (Nov 18).
    expect(
      follow("RRULE:FREQ=MONTHLY;BYDAY=2TU", "2026-11-10", "2026-11-18")
    ).toBe("RRULE:FREQ=MONTHLY;BYDAY=3WE");
    // A last Friday stays a last.
    expect(
      follow("RRULE:FREQ=MONTHLY;BYDAY=-1FR", "2026-11-27", "2026-12-31")
    ).toBe("RRULE:FREQ=MONTHLY;BYDAY=-1TH");
    expect(
      follow("RRULE:FREQ=MONTHLY;BYMONTHDAY=7", "2026-11-07", "2026-11-09")
    ).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=9");
    // Not the start's own: left alone.
    expect(
      follow("RRULE:FREQ=MONTHLY;BYDAY=1MO", "2026-11-10", "2026-11-18")
    ).toBe("RRULE:FREQ=MONTHLY;BYDAY=1MO");
  });

  test("moves an end the start passed three months on", () => {
    expect(
      follow(
        "RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z",
        "2026-11-07",
        "2026-12-12"
      )
    ).toBe("RRULE:FREQ=WEEKLY;UNTIL=20270313T045959Z");
  });
});
