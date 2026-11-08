import { describe, expect, test } from "bun:test";
import {
  buildGoogleEventRecurrenceRule,
  describeEventRecurrence,
  type EventRecurrencePattern,
  getPrimaryRecurrenceRule,
  monthlyWeekdayOf,
  ordinalDayLabel,
  parseGoogleEventRecurrenceRule,
  pickRecurrenceFrequency,
  setPrimaryRecurrenceRule,
  untilRuleForDay,
  untilRuleToDate,
} from "./google-event-recurrence";

describe("describeEventRecurrence", () => {
  test("says how a series repeats", () => {
    expect(
      describeEventRecurrence({ rules: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"] })
    ).toBe("Repeats weekly on Mon, Wed");
    expect(
      describeEventRecurrence({ rules: ["RRULE:FREQ=DAILY;INTERVAL=2"] })
    ).toBe("Repeats every 2 days");
  });

  test("names the day of a monthly or yearly series", () => {
    expect(
      describeEventRecurrence({
        rules: ["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU"],
      })
    ).toBe("Repeats every 2 months on the 2nd Tue");
    expect(
      describeEventRecurrence({ rules: ["RRULE:FREQ=MONTHLY;BYDAY=-1FR"] })
    ).toBe("Repeats monthly on the last Fri");
    expect(
      describeEventRecurrence({
        rules: ["RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH"],
      })
    ).toBe("Repeats yearly on the 4th Thu of Nov");
    expect(
      describeEventRecurrence({ rules: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=15"] })
    ).toBe("Repeats monthly on day 15");
    // The 4th Thursday of the year, not of a month: not put in words.
    expect(
      describeEventRecurrence({ rules: ["RRULE:FREQ=YEARLY;BYDAY=4TH"] })
    ).toBe("Repeats yearly");
  });

  test("still says an instance repeats when its rule isn't loaded", () => {
    expect(
      describeEventRecurrence({ recurringEventId: "series", rules: [] })
    ).toBe("Repeats");
    expect(
      describeEventRecurrence({ eventType: "birthday", rules: undefined })
    ).toBe("Repeats yearly");
    expect(describeEventRecurrence({ rules: [] })).toBeNull();
  });
});

test("describes a yearly rule, and any other as repeating", () => {
  expect(describeEventRecurrence({ rules: ["RRULE:FREQ=YEARLY"] })).toBe(
    "Repeats yearly"
  );
  expect(describeEventRecurrence({ rules: ["RRULE:FREQ=HOURLY"] })).toBe(
    "Repeats"
  );
});

test("names the start's weekday for a weekly rule with no days", () => {
  expect(
    describeEventRecurrence({ rules: ["RRULE:FREQ=WEEKLY"], startWeekday: 6 })
  ).toBe("Repeats weekly on Sat");
  expect(
    describeEventRecurrence({
      rules: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      startWeekday: 6,
    })
  ).toBe("Repeats weekly on Mon");
});

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

  test("a weekday of the month replaces a day of the month", () => {
    expect(
      edit("RRULE:FREQ=MONTHLY;BYMONTHDAY=10", (p) => ({
        ...p,
        byDay: ["2TU"],
      }))
    ).toBe("RRULE:FREQ=MONTHLY;BYDAY=2TU");
  });
});

describe("monthlyWeekdayOf", () => {
  test("names the weekday of the month, a 5th as the last", () => {
    // Nov 10, 2026 is the 2nd Tuesday; Dec 29 the 5th (last) Tuesday.
    expect(monthlyWeekdayOf({ day: 10, dayOfWeek: 2 })).toBe("2TU");
    expect(monthlyWeekdayOf({ day: 29, dayOfWeek: 2 })).toBe("-1TU");
    expect(ordinalDayLabel("-1TU")).toBe("last Tue");
  });
});

describe("untilRuleForDay", () => {
  test("ends after the picked day's occurrence", () => {
    const day = new Date(2026, 11, 5);
    expect(untilRuleForDay(day, true)).toBe("20261205");
    // The day's last second, so a 10 AM meeting on Dec 5 is still in.
    const until = untilRuleToDate(untilRuleForDay(day, false));
    expect(until?.getDate()).toBe(5);
    expect(until && until > new Date(2026, 11, 5, 23, 58)).toBe(true);
  });
});
