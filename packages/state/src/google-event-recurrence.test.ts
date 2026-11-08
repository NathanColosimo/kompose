import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  buildGoogleEventRecurrenceRule,
  dayInZone,
  type EventRecurrencePattern,
  followStart,
  getPrimaryRecurrenceRule,
  lastWeekdayOf,
  monthlyWeekdayOf,
  occurrenceDayMoved,
  parseGoogleEventRecurrenceRule,
  pickRecurrenceFrequency,
  seriesRecurrenceForSave,
  setPrimaryRecurrenceRule,
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

  test("keeps a series' other rules", () => {
    // Mondays and Fridays as two rules: changing the first keeps Fridays.
    expect(
      setPrimaryRecurrenceRule(
        ["RRULE:FREQ=WEEKLY;BYDAY=MO", "RRULE:FREQ=WEEKLY;BYDAY=FR", exdate],
        "RRULE:FREQ=WEEKLY;BYDAY=TU"
      )
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "RRULE:FREQ=WEEKLY;BYDAY=FR",
      exdate,
    ]);
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
      // The later of the 15th and the 30th: BYSETPOS stays with its days.
      [
        "RRULE:FREQ=MONTHLY;BYMONTHDAY=15,30;BYSETPOS=-1",
        "RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYMONTHDAY=15,30;COUNT=5",
      ],
      [
        "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
        "RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR;COUNT=5",
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

  test("a weekday of the month picked in the editor replaces a day", () => {
    expect(
      edit("RRULE:FREQ=MONTHLY;BYMONTHDAY=10", (p) => ({
        ...p,
        byDay: ["2TU"],
        monthDays: [],
      }))
    ).toBe("RRULE:FREQ=MONTHLY;BYDAY=2TU");
  });

  test("an end-only edit keeps a weekday and a day of the month together", () => {
    // The 2nd Tue, only when it's the 8th to the 10th.
    expect(
      edit("RRULE:FREQ=MONTHLY;BYDAY=2TU;BYMONTHDAY=8,9,10", (p) => ({
        ...p,
        end: { count: 5, type: "count" },
      }))
    ).toBe("RRULE:FREQ=MONTHLY;BYMONTHDAY=8,9,10;BYDAY=2TU;COUNT=5");
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

  test("swaps a weekly series' start weekday for the new one", () => {
    // Tue Nov 10 to Wed Nov 11.
    expect(
      follow("RRULE:FREQ=WEEKLY;BYDAY=TU", "2026-11-10", "2026-11-11")
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE");
    expect(
      follow("RRULE:FREQ=WEEKLY;BYDAY=TU,TH", "2026-11-10", "2026-11-11")
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE,TH");
    // Several days keep their set when the new start is one of them: a
    // weekday standup moved to Tuesday still meets on Mondays.
    expect(
      follow("RRULE:FREQ=WEEKLY;BYDAY=TU,WE", "2026-11-10", "2026-11-11")
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU,WE");
    expect(
      follow(
        "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        "2026-11-09",
        "2026-11-10"
      )
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  test("carries a yearly month and a BYSETPOS weekday", () => {
    // The 4th Thu of Nov (Nov 26) to the 4th Thu of Dec (Dec 24).
    expect(
      follow(
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
        "2026-11-26",
        "2026-12-24"
      )
    ).toBe("RRULE:FREQ=YEARLY;BYMONTH=12;BYDAY=4TH");
    expect(
      follow(
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=7",
        "2026-11-07",
        "2026-12-07"
      )
    ).toBe("RRULE:FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=7");
    // "BYDAY=SA;BYSETPOS=1" (the 1st Sat) moved to the 2nd Sat.
    expect(
      follow(
        "RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1",
        "2026-11-07",
        "2026-11-14"
      )
    ).toBe("RRULE:FREQ=MONTHLY;BYDAY=2SA");
  });

  test("moves skipped days with the pattern, so none comes back", () => {
    const followed = (recurrence: string[], from: string, to: string) =>
      followStart({
        allDay: false,
        from: day(from),
        recurrence,
        timeZone: zone,
        to: day(to),
      });
    // Mondays to Tuesdays: the skipped Monday Nov 16 is Tuesday Nov 17.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "EXDATE;TZID=America/New_York:20261116T090000",
        ],
        "2026-11-09",
        "2026-11-10"
      )
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE;TZID=America/New_York:20261117T090000",
    ]);
    // A plain weekly rule follows its start without naming it.
    expect(
      followed(
        ["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261116"],
        "2026-11-09",
        "2026-11-10"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261117"]);
    // A skipped day that wasn't a Monday wasn't the pattern's: it stays.
    const friday = ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20261120"];
    expect(followed(friday, "2026-11-09", "2026-11-10")).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE;VALUE=DATE:20261120",
    ]);
    // A daily series still meets on Nov 16: that skip is a date, and stays.
    const daily = ["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20261116"];
    expect(followed(daily, "2026-11-09", "2026-11-10")).toBe(daily);
    // The 2nd Tue to the 3rd Wed: the skipped Dec 8 is Dec 16.
    expect(
      followed(
        ["RRULE:FREQ=MONTHLY;BYDAY=2TU", "EXDATE;VALUE=DATE:20261208"],
        "2026-11-10",
        "2026-11-18"
      )
    ).toEqual(["RRULE:FREQ=MONTHLY;BYDAY=3WE", "EXDATE;VALUE=DATE:20261216"]);
  });

  test("never moves a skip onto a real meeting", () => {
    const followed = (recurrence: string[], from: string, to: string) =>
      followStart({
        allDay: true,
        from: day(from),
        recurrence,
        timeZone: zone,
        to: day(to),
      });
    // Daily, moved Nov 9 -> Nov 12 with Nov 10 skipped: the skip is a date.
    const daily = ["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20261110"];
    expect(followed(daily, "2026-11-09", "2026-11-12")).toBe(daily);
    // Mondays moved to Wed Nov 18 with Nov 16 skipped: its week's Wednesday
    // is the meeting just moved, so the skip stays (Nov 25 still meets).
    expect(
      followed(
        ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20261116"],
        "2026-11-09",
        "2026-11-18"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;VALUE=DATE:20261116"]);
    // Every 2 months on the 4th Thu, moved Nov 26 -> Wed Dec 2 (1st Wed):
    // the skipped Jan 28 is two months on, so Feb 3.
    expect(
      followed(
        [
          "RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=4TH",
          "EXDATE;VALUE=DATE:20270128",
        ],
        "2026-11-26",
        "2026-12-02"
      )
    ).toEqual([
      "RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=1WE",
      "EXDATE;VALUE=DATE:20270203",
    ]);
  });

  test("moves weekly skips by the move, across a week's end", () => {
    const followed = (recurrence: string[], from: string, to: string) =>
      followStart({
        allDay: true,
        from: day(from),
        recurrence,
        timeZone: zone,
        to: day(to),
      });
    const cases: [string, string, string, string, string][] = [
      // Sundays -> Mondays: the skipped Nov 22 is Nov 23.
      [
        "RRULE:FREQ=WEEKLY;BYDAY=SU",
        "2026-11-08",
        "2026-11-09",
        "20261122",
        "20261123",
      ],
      // Fridays -> Mondays: Nov 27 is Nov 30.
      [
        "RRULE:FREQ=WEEKLY;BYDAY=FR",
        "2026-11-13",
        "2026-11-16",
        "20261127",
        "20261130",
      ],
      // Mondays -> the Sunday before: Nov 23 is Nov 22.
      [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "2026-11-09",
        "2026-11-08",
        "20261123",
        "20261122",
      ],
      // Every 2 weeks on Sunday -> Monday: Nov 22 is Nov 23.
      [
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU",
        "2026-11-08",
        "2026-11-09",
        "20261122",
        "20261123",
      ],
      // Every 2 weeks Mon/Tue, the start moved onto the next Tue (both
      // days kept, the weeks shifted one): the skipped Mon Nov 16 is Mon
      // Nov 23, not a Tuesday.
      [
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU",
        "2026-11-02",
        "2026-11-10",
        "20261116",
        "20261123",
      ],
    ];
    for (const [rule, from, to, skipped, moved] of cases) {
      const next = followed([rule, `EXDATE;VALUE=DATE:${skipped}`], from, to);
      expect(next[1]).toBe(`EXDATE;VALUE=DATE:${moved}`);
    }
    // Every other day moved a day later: the skipped Nov 13 is Nov 14.
    expect(
      followed(
        ["RRULE:FREQ=DAILY;INTERVAL=2", "EXDATE;VALUE=DATE:20261113"],
        "2026-11-09",
        "2026-11-10"
      )
    ).toEqual(["RRULE:FREQ=DAILY;INTERVAL=2", "EXDATE;VALUE=DATE:20261114"]);
  });

  test("moves interval and yearly skips to the new rule's matching day", () => {
    const followed = (recurrence: string[], from: string, to: string) =>
      followStart({
        allDay: true,
        from: day(from),
        recurrence,
        timeZone: zone,
        to: day(to),
      });
    // Every 2 weeks on Monday, moved Nov 9 -> Wed Nov 18 (+9 days): the
    // skipped Nov 23 is Dec 2.
    expect(
      followed(
        ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "EXDATE;VALUE=DATE:20261123"],
        "2026-11-09",
        "2026-11-18"
      )
    ).toEqual([
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
      "EXDATE;VALUE=DATE:20261202",
    ]);
    // Yearly on the 9th of every month, moved Jan 9 -> Feb 10: a skip
    // stays in its own month (Jun 9 is Jun 10), as the person is away then.
    expect(
      followed(
        ["RRULE:FREQ=YEARLY;BYMONTHDAY=9", "EXDATE;VALUE=DATE:20270609"],
        "2027-01-09",
        "2027-02-10"
      )
    ).toEqual([
      "RRULE:FREQ=YEARLY;BYMONTHDAY=10",
      "EXDATE;VALUE=DATE:20270610",
    ]);
  });

  test("keeps a month's skip in its month when the day moves a little", () => {
    // Monthly on the 31st moved to the 30th: the skipped May 31 is May 30,
    // not April's meeting.
    expect(
      followStart({
        allDay: true,
        from: day("2027-01-31"),
        recurrence: ["RRULE:FREQ=MONTHLY", "EXDATE;VALUE=DATE:20270531"],
        timeZone: zone,
        to: day("2027-01-30"),
      })
    ).toEqual(["RRULE:FREQ=MONTHLY", "EXDATE;VALUE=DATE:20270530"]);
  });

  test("moves monthly and yearly skips next to their time, either way", () => {
    const followed = (recurrence: string[], from: string, to: string) =>
      followStart({
        allDay: true,
        from: day(from),
        recurrence,
        timeZone: zone,
        to: day(to),
      })[1];
    const cases: [string, string, string, string, string][] = [
      // A day later across a month's end: May 31 -> Jun 1.
      [
        "RRULE:FREQ=MONTHLY",
        "2027-01-31",
        "2027-02-01",
        "20270531",
        "20270601",
      ],
      // Every 2 months, moved back a month: Mar 15 -> Feb 15.
      [
        "RRULE:FREQ=MONTHLY;INTERVAL=2",
        "2027-01-15",
        "2026-12-15",
        "20270315",
        "20270215",
      ],
      // Last Fri -> 1st Mon (Jan 29 -> Feb 1): May 28 -> Jun 7.
      [
        "RRULE:FREQ=MONTHLY;BYDAY=-1FR",
        "2027-01-29",
        "2027-02-01",
        "20270528",
        "20270607",
      ],
      // Sol's: Nov 9 -> Oct 9 yearly; every 2 months Mar 9 -> Feb 9.
      ["RRULE:FREQ=YEARLY", "2026-11-09", "2026-10-09", "20271109", "20271009"],
      [
        "RRULE:FREQ=MONTHLY;INTERVAL=2",
        "2027-03-09",
        "2027-02-09",
        "20270709",
        "20270609",
      ],
      // Yearly moved earlier: Dec 9 -> Nov 9 keeps 2027's skip, in Nov.
      ["RRULE:FREQ=YEARLY", "2026-12-09", "2026-11-09", "20271209", "20271109"],
      // Mar 1 -> Feb 28: the 2028 skip is Feb 28 2028.
      [
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1",
        "2027-03-01",
        "2027-02-28",
        "20280301",
        "20280228",
      ],
    ];
    for (const [rule, from, to, skipped, moved] of cases) {
      expect(followed([rule, `EXDATE;VALUE=DATE:${skipped}`], from, to)).toBe(
        `EXDATE;VALUE=DATE:${moved}`
      );
    }
  });

  test("keeps skips off real meetings and the picked day", () => {
    const followed = (recurrence: string[], from: string, to: string) =>
      followStart({
        allDay: true,
        from: day(from),
        recurrence,
        timeZone: zone,
        to: day(to),
      });
    // The 2nd Tue moved Jan 12 -> Feb 17 (the 3rd Wed): the skipped Jun 8
    // is June's 3rd Wed (Jun 16), not July's.
    expect(
      followed(
        ["RRULE:FREQ=MONTHLY;BYDAY=2TU", "EXDATE;VALUE=DATE:20270608"],
        "2027-01-12",
        "2027-02-17"
      )
    ).toEqual(["RRULE:FREQ=MONTHLY;BYDAY=3WE", "EXDATE;VALUE=DATE:20270616"]);
    // The start moved onto a skipped day: that day was picked, so it meets.
    expect(
      followed(
        ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20261116"],
        "2026-11-09",
        "2026-11-16"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  });

  test("moves skips across month and year ends, and BYSETPOS ones", () => {
    const followed = (recurrence: string[], from: string, to: string) =>
      followStart({
        allDay: true,
        from: day(from),
        recurrence,
        timeZone: zone,
        to: day(to),
      });
    // Monthly Nov 30 -> Dec 1 (+1 day): the skipped Dec 30 is Jan 1, the
    // meeting next to that time.
    expect(
      followed(
        ["RRULE:FREQ=MONTHLY", "EXDATE;VALUE=DATE:20261230"],
        "2026-11-30",
        "2026-12-01"
      )
    ).toEqual(["RRULE:FREQ=MONTHLY", "EXDATE;VALUE=DATE:20270101"]);
    // Yearly Nov 9 -> Dec 9: the skipped Nov 9 2027 is Dec 9 2027.
    expect(
      followed(
        ["RRULE:FREQ=YEARLY", "EXDATE;VALUE=DATE:20271109"],
        "2026-11-09",
        "2026-12-09"
      )
    ).toEqual(["RRULE:FREQ=YEARLY", "EXDATE;VALUE=DATE:20271209"]);
    // The 2nd Tue written with BYSETPOS, moved to the 3rd Wed: Dec 8 is Dec 16.
    expect(
      followed(
        [
          "RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2",
          "EXDATE;VALUE=DATE:20261208",
        ],
        "2026-11-10",
        "2026-11-18"
      )
    ).toEqual(["RRULE:FREQ=MONTHLY;BYDAY=3WE", "EXDATE;VALUE=DATE:20261216"]);
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

describe("dayInZone", () => {
  test("names the day a shown start falls on in the series' zone", () => {
    // Monday 7 PM in New York is Tuesday 9 AM in Tokyo.
    expect(
      dayInZone(
        day("2026-11-09"),
        Temporal.PlainTime.from("19:00"),
        "America/New_York",
        "Asia/Tokyo"
      ).toString()
    ).toBe("2026-11-10");
    // All day: the same day everywhere.
    expect(
      dayInZone(
        day("2026-11-09"),
        null,
        "America/New_York",
        "Asia/Tokyo"
      ).toString()
    ).toBe("2026-11-09");
  });
});

describe("seriesRecurrenceForSave", () => {
  const after = (recurrence?: string[]) =>
    seriesRecurrenceForSave({
      editedStart: { dateTime: "2026-11-14T16:00:00-05:00" },
      masterRecurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1SA"],
      occurrence: {
        originalStartTime: { dateTime: "2026-11-07T16:00:00-05:00" },
        recurringEventId: "series",
        start: { dateTime: "2026-11-07T16:00:00-05:00" },
      },
      recurrence,
      timeZone: "America/New_York",
    });

  test("carries the series' rule with a moved occurrence", () => {
    expect(after()).toEqual(["RRULE:FREQ=MONTHLY;BYDAY=2SA"]);
  });

  test("gives the series' end the form its start takes", () => {
    const save = (editedStart: { date?: string; dateTime?: string }) =>
      seriesRecurrenceForSave({
        editedStart,
        masterRecurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z"],
        occurrence: {
          originalStartTime: { dateTime: "2026-11-07T16:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-07T16:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      });
    // Made all day: the end is the date.
    expect(save({ date: "2026-11-07" })).toEqual([
      "RRULE:FREQ=WEEKLY;UNTIL=20261205",
    ]);
    // Unchanged: nothing to send.
    expect(save({ dateTime: "2026-11-07T16:00:00-05:00" })).toBeUndefined();
  });

  test("follows only a day this edit moves, from the series' slot", () => {
    // A Monday occurrence rescheduled to Tuesday before.
    const rescheduled = {
      originalStartTime: { dateTime: "2026-11-09T09:00:00-05:00" },
      recurringEventId: "series",
      start: { dateTime: "2026-11-10T09:00:00-05:00" },
    };
    const save = (dateTime: string) =>
      seriesRecurrenceForSave({
        editedStart: { dateTime },
        masterRecurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        occurrence: rescheduled,
        recurrence: undefined,
        timeZone: "America/New_York",
      });
    // Only renamed: the series keeps its Mondays.
    expect(save("2026-11-10T09:00:00-05:00")).toBeUndefined();
    expect(
      occurrenceDayMoved({
        editedStart: { dateTime: "2026-11-10T09:00:00-05:00" },
        occurrence: rescheduled,
        timeZone: "America/New_York",
      })
    ).toBe(false);
    // Moved on to Wednesday: Mondays become Wednesdays.
    expect(save("2026-11-11T09:00:00-05:00")).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
    ]);
  });

  test("counts days in the series' own zone", () => {
    // A Tuesday 9:00 Tokyo meeting moved to Wednesday 9:00, seen from New York.
    expect(
      seriesRecurrenceForSave({
        editedStart: {
          dateTime: "2026-11-11T00:00:00.000Z",
          timeZone: "Asia/Tokyo",
        },
        masterRecurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
        occurrence: {
          originalStartTime: { dateTime: "2026-11-10T09:00:00+09:00" },
          recurringEventId: "series",
          start: {
            dateTime: "2026-11-10T09:00:00+09:00",
            timeZone: "Asia/Tokyo",
          },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE"]);
  });

  test("leaves a rule the save already sends alone", () => {
    expect(after(["RRULE:FREQ=WEEKLY"])).toBeUndefined();
  });
});
