import { describe, expect, test } from "bun:test";
import { matchRecurrenceToStart } from "@kompose/google-cal/until";
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
  occurrenceRepeatShown,
  parseGoogleEventRecurrenceRule,
  pickRecurrenceFrequency,
  repeatCountingDay,
  repeatEndsBeforeStart,
  repeatSkipsOccurrence,
  seriesCountingDays,
  seriesRecurrenceForSave,
  setPrimaryRecurrenceRule,
  untilDefaultDay,
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

  test("writes the days in week order, Monday first", () => {
    // Thursday added after Monday, Wednesday and Friday.
    expect(
      edit("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", (pattern) => ({
        ...pattern,
        byDay: [...pattern.byDay, "TH"],
      }))
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,TH,FR");
    expect(
      edit("RRULE:FREQ=WEEKLY;BYDAY=SU", (pattern) => ({
        ...pattern,
        byDay: [...pattern.byDay, "MO"],
      }))
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,SU");
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
      // Opus's: a month and a day across February, back again, and the
      // 1st -> the 31st (30 days): Jun 1 -> Jun 2, Jun 2 -> Jun 1, May 1
      // -> May 31.
      [
        "RRULE:FREQ=MONTHLY",
        "2027-02-01",
        "2027-03-02",
        "20270601",
        "20270602",
      ],
      [
        "RRULE:FREQ=MONTHLY",
        "2027-03-02",
        "2027-02-01",
        "20270602",
        "20270601",
      ],
      [
        "RRULE:FREQ=MONTHLY",
        "2027-03-01",
        "2027-03-31",
        "20270501",
        "20270531",
      ],
      // Sol's: Mar 1 -> Jan 31 (the 31st from now on): Jun 1 -> May 31.
      [
        "RRULE:FREQ=MONTHLY",
        "2027-03-01",
        "2027-01-31",
        "20270601",
        "20270531",
      ],
      // Opus's: into the next month onto an earlier day (or back onto a
      // later one) is a month and a few days, not 30 days on.
      [
        "RRULE:FREQ=MONTHLY",
        "2027-03-15",
        "2027-04-14",
        "20270615",
        "20270614",
      ],
      [
        "RRULE:FREQ=MONTHLY",
        "2027-03-31",
        "2027-04-30",
        "20270531",
        "20270530",
      ],
      [
        "RRULE:FREQ=MONTHLY",
        "2027-01-31",
        "2027-02-28",
        "20270331",
        "20270328",
      ],
      [
        "RRULE:FREQ=MONTHLY",
        "2027-01-30",
        "2027-02-27",
        "20270430",
        "20270427",
      ],
      [
        "RRULE:FREQ=MONTHLY",
        "2027-03-15",
        "2027-02-16",
        "20270615",
        "20270616",
      ],
      // Every 2 months, a month on and a day back: Jul 15 -> Aug 14.
      [
        "RRULE:FREQ=MONTHLY;INTERVAL=2",
        "2027-03-15",
        "2027-04-14",
        "20270715",
        "20270814",
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
    // Twice a day (9:00, 15:00) moved onto a day with both skipped: the
    // start's own 9:00 meets; the skipped 15:00 stays skipped.
    expect(
      followStart({
        allDay: false,
        from: day("2026-11-09"),
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15",
          "EXDATE;TZID=America/New_York:20261116T090000,20261116T150000",
        ],
        timeZone: "America/New_York",
        to: day("2026-11-16"),
        toTime: Temporal.PlainTime.from("09:00"),
      })
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYHOUR=9,15;BYDAY=MO",
      "EXDATE;TZID=America/New_York:20261116T150000",
    ]);
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

  test("keeps a rule the editor can't write when the day moves", () => {
    // Every 4 hours: moving its start (in the editor, or an occurrence
    // "This and following") keeps the rule, rather than ending the series.
    const hourly = ["RRULE:FREQ=HOURLY;INTERVAL=4;COUNT=10"];
    expect(
      followStart({
        allDay: false,
        from: Temporal.PlainDate.from("2026-11-09"),
        recurrence: hourly,
        timeZone: "America/New_York",
        to: Temporal.PlainDate.from("2026-11-10"),
      })
    ).toBe(hourly);
    expect(
      seriesRecurrenceForSave({
        editedStart: { dateTime: "2026-11-10T09:00:00-05:00" },
        masterRecurrence: hourly,
        occurrence: {
          originalStartTime: { dateTime: "2026-11-09T09:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-09T09:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      })
      // Nothing to send: the series keeps its rule.
    ).toBeUndefined();
  });

  test("moves a kept rule's passed end on and unskips the picked start", () => {
    // Every 4 hours until Nov 10, its start dragged onto Nov 17 at 9:00,
    // which was skipped: the end moves three months on, and 9:00 meets.
    expect(
      followStart({
        allDay: false,
        from: Temporal.PlainDate.from("2026-11-09"),
        recurrence: [
          "RRULE:FREQ=HOURLY;INTERVAL=4;UNTIL=20261111T045959Z",
          "EXDATE;TZID=America/New_York:20261117T090000,20261117T130000",
        ],
        timeZone: "America/New_York",
        to: Temporal.PlainDate.from("2026-11-17"),
        toTime: Temporal.PlainTime.from("09:00"),
      })
    ).toEqual([
      "RRULE:FREQ=HOURLY;INTERVAL=4;UNTIL=20270218T045959Z",
      "EXDATE;TZID=America/New_York:20261117T130000",
    ]);
  });

  test("moves only the moved rule's skipped times", () => {
    const followed = (recurrence: string[], to: string, toTime: string) =>
      followStart({
        allDay: false,
        from: Temporal.PlainDate.from("2026-11-09"),
        fromTime: Temporal.PlainTime.from("09:00"),
        recurrence,
        timeZone: "America/New_York",
        to: Temporal.PlainDate.from(to),
        toTime: Temporal.PlainTime.from(toTime),
      });
    // Mondays 9:00 and 15:00 as two rules; the 9:00 one moves to Tuesdays.
    // Its skipped Nov 16 9:00 moves to Nov 17; the 15:00 rule's skip stays.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=15",
          "EXDATE;TZID=America/New_York:20261116T090000,20261116T150000",
        ],
        "2026-11-10",
        "09:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261117T090000,20261116T150000");
    // A rule with no time of its own meets at the start's: moved to
    // Tuesdays at 10:00, its skipped Nov 16 9:00 is Nov 17 at 10:00.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=15",
          "EXDATE;TZID=America/New_York:20261116T090000",
        ],
        "2026-11-10",
        "10:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261117T100000");
    // Another rule still meets at the skipped Monday 9:00 (Mondays and
    // Fridays at 9:00 and 15:00): the skip stays where that rule needs it.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
          "RRULE:FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9,15",
          "EXDATE;TZID=America/New_York:20261116T090000",
        ],
        "2026-11-10",
        "09:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261116T090000");
    // That rule ended (UNTIL Nov 23, or after 4 Mondays/Fridays): a later
    // Monday skip is the moved rule's alone, and moves.
    for (const end of ["UNTIL=20261124T045959Z", "COUNT=4"]) {
      expect(
        followed(
          [
            "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
            `RRULE:FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;${end}`,
            "EXDATE;TZID=America/New_York:20261130T090000",
          ],
          "2026-11-10",
          "09:00"
        ).at(-1)
      ).toBe("EXDATE;TZID=America/New_York:20261201T090000");
    }
    // Another rule already meets on Tuesdays at 9:00: the skip doesn't
    // land on its real meeting.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
          "RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=9",
          "EXDATE;TZID=America/New_York:20261116T090000",
        ],
        "2026-11-10",
        "09:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261116T090000");
    // A rule that sets only its minute takes its hour from the start:
    // moved to Tuesdays at 10:00, its skipped Nov 16 9:00 is Nov 17 10:00.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYMINUTE=0",
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=15",
          "EXDATE;TZID=America/New_York:20261116T090000",
        ],
        "2026-11-10",
        "10:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261117T100000");
    // Mon/Wed (the start's time) and Mondays 15:00, moved Mon 9:00 -> Tue
    // 10:00: the Monday skip moves to Tuesday 10:00, and the Wednesday one
    // stays on its day at the rule's new 10:00.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=15",
          "EXDATE;TZID=America/New_York:20261116T090000,20261118T090000",
        ],
        "2026-11-10",
        "10:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261117T100000,20261118T100000");
    // Moved onto a Wednesday whose 9:00 was skipped, at 10:00: retimed,
    // that skip would hide the meeting just placed, so it goes (also for
    // one rule at 9:00 and 15:00 moved to 9:30).
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=15",
          "EXDATE;TZID=America/New_York:20261111T090000",
        ],
        "2026-11-11",
        "10:00"
      ).some((line) => line.startsWith("EXDATE"))
    ).toBe(false);
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9,15",
          "EXDATE;TZID=America/New_York:20261111T090000",
        ],
        "2026-11-11",
        "09:30"
      ).some((line) => line.startsWith("EXDATE"))
    ).toBe(false);
    // Retimed to 10:00, the Wednesday skip would land on another rule's
    // real 10:00 meeting: it stays at 9:00.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
          "RRULE:FREQ=WEEKLY;BYDAY=WE;BYHOUR=10",
          "EXDATE;TZID=America/New_York:20261118T090000",
        ],
        "2026-11-10",
        "10:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261118T090000");
    // A Wednesday 9:00 skip isn't the moved Monday rule's (it never met
    // on Wednesdays): moving Mondays to Tuesdays at 9:30 leaves it be.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RRULE:FREQ=WEEKLY;BYDAY=WE;BYHOUR=15",
          "EXDATE;TZID=America/New_York:20261118T090000",
        ],
        "2026-11-10",
        "09:30"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261118T090000");
    // An added Tue Nov 17 9:00: Mondays moved to Tuesdays, the skipped
    // Nov 16 would land on it and cancel it, so it stays; Nov 23 moves.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261117T090000",
          "EXDATE;TZID=America/New_York:20261116T090000,20261123T090000",
        ],
        "2026-11-10",
        "09:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261116T090000,20261124T090000");
    // A skip moved onto one already there is written once.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "EXDATE;TZID=America/New_York:20261116T090000,20261117T100000",
        ],
        "2026-11-10",
        "10:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261117T100000");
    // One rule at 9:00 and 15:00 moved to Tuesdays: both skips move.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15",
          "EXDATE;TZID=America/New_York:20261116T090000,20261116T150000",
        ],
        "2026-11-10",
        "09:00"
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261117T090000,20261117T150000");
    // BYHOUR=9 and BYHOUR=9;BYMINUTE=0 are one 9:00: moved onto Friday
    // Nov 13 at 10:00, that day's skipped 9:00 is the picked start's.
    expect(
      followed(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
          "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0",
          "EXDATE;TZID=America/New_York:20261113T090000",
        ],
        "2026-11-13",
        "10:00"
      ).some((line) => line.startsWith("EXDATE"))
    ).toBe(false);
  });

  test("keeps a cancelled added meeting on the day the start moves to", () => {
    // Mondays 9:00 with an added, then cancelled, Tue Nov 10 15:00 (and a
    // 9:00 skip that day); the series moved onto Tue Nov 10 9:00: the 9:00
    // skip goes (that's the start just placed), the 15:00 stays cancelled.
    expect(
      seriesRecurrenceForSave({
        editedStart: { dateTime: "2026-11-10T09:00:00-05:00" },
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261110T150000",
          "EXDATE;TZID=America/New_York:20261110T150000,20261110T090000",
        ],
        occurrence: {
          originalStartTime: { dateTime: "2026-11-09T09:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-09T09:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      })
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "RDATE;TZID=America/New_York:20261110T150000",
      "EXDATE;TZID=America/New_York:20261110T150000",
    ]);
  });

  test("never leaves an all-day start's own day skipped", () => {
    // Moved onto Tue Nov 10, where an added 15:00 was cancelled, and made
    // all day: the start takes the whole day, so no skip is left on it.
    expect(
      seriesRecurrenceForSave({
        editedStart: { date: "2026-11-10" },
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261110T150000",
          "EXDATE;TZID=America/New_York:20261110T150000",
        ],
        occurrence: {
          originalStartTime: { dateTime: "2026-11-09T09:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-09T09:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU", "RDATE;VALUE=DATE:20261110"]);
  });

  test("keeps skips when a series moves a day and goes all day", () => {
    // Rules that take their day from the start (monthly on the 9th, or
    // weekly on the start's weekday) moved to Nov 10 and made all day:
    // their moved skip becomes its date.
    const movedAllDay = (rule: string, exdate: string) =>
      seriesRecurrenceForSave({
        editedStart: { date: "2026-11-10" },
        masterRecurrence: [rule, `EXDATE;TZID=America/New_York:${exdate}`],
        occurrence: {
          originalStartTime: { dateTime: "2026-11-09T09:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-09T09:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      });
    expect(movedAllDay("RRULE:FREQ=MONTHLY", "20261209T090000")).toEqual([
      "RRULE:FREQ=MONTHLY",
      "EXDATE;VALUE=DATE:20261210",
    ]);
    expect(movedAllDay("RRULE:FREQ=WEEKLY", "20261116T090000")).toEqual([
      "RRULE:FREQ=WEEKLY",
      "EXDATE;VALUE=DATE:20261117",
    ]);
  });

  test("counts from the occurrence's place when its day didn't move", () => {
    // Mon Nov 9, rescheduled before to Tue Nov 10, made all day there for
    // the series: the day didn't move, so the client sends nothing, and the
    // server lines the series' own rule up with its first day (Nov 9), the
    // rule and its skip staying on the series' days (Nov 16, Dec 9).
    for (const [rule, exdate, expected] of [
      ["RRULE:FREQ=WEEKLY", "20261116T090000", "EXDATE;VALUE=DATE:20261116"],
      ["RRULE:FREQ=MONTHLY", "20261209T090000", "EXDATE;VALUE=DATE:20261209"],
    ] as const) {
      const recurrence = [rule, `EXDATE;TZID=America/New_York:${exdate}`];
      expect(
        seriesRecurrenceForSave({
          editedStart: { date: "2026-11-10" },
          masterRecurrence: recurrence,
          masterStart: { dateTime: "2026-11-09T09:00:00-05:00" },
          occurrence: {
            originalStartTime: { dateTime: "2026-11-09T09:00:00-05:00" },
            recurringEventId: "series",
            start: { dateTime: "2026-11-10T09:00:00-05:00" },
          },
          recurrence: undefined,
          timeZone: "America/New_York",
        })
      ).toBeUndefined();
      expect(
        matchRecurrenceToStart(
          recurrence,
          { date: "2026-11-09" },
          "America/New_York",
          { dateTime: "2026-11-09T09:00:00-05:00" }
        )
      ).toEqual([rule, expected]);
    }
  });

  test("keeps skips before the occurrence made all day for the series", () => {
    // Daily from Nov 9, Nov 10 and Nov 17 skipped; the Nov 16 occurrence
    // made all day for the series: the client sends nothing (the day didn't
    // move), and the server's lining-up keeps both skips.
    const rule = [
      "RRULE:FREQ=DAILY",
      "EXDATE;TZID=America/New_York:20261110T090000,20261117T090000",
    ];
    const expected = [
      "RRULE:FREQ=DAILY",
      "EXDATE;VALUE=DATE:20261110,20261117",
    ];
    for (const masterStart of [
      { dateTime: "2026-11-09T09:00:00-05:00" },
      undefined,
    ]) {
      expect(
        seriesRecurrenceForSave({
          editedStart: { date: "2026-11-16" },
          masterRecurrence: rule,
          masterStart,
          occurrence: {
            originalStartTime: { dateTime: "2026-11-16T09:00:00-05:00" },
            recurringEventId: "series",
            start: { dateTime: "2026-11-16T09:00:00-05:00" },
          },
          recurrence: undefined,
          timeZone: "America/New_York",
        })
      ).toBeUndefined();
    }
    expect(
      matchRecurrenceToStart(rule, { date: "2026-11-09" }, "America/New_York", {
        dateTime: "2026-11-09T09:00:00-05:00",
      })
    ).toEqual(expected);
  });

  test("counts a moved first occurrence's COUNT from its new day", () => {
    // Five weeks (or three months) from Mon Nov 2 9:00, the last but one
    // skipped; the first occurrence moved to Tue Nov 3 and made all day:
    // the rule and its skip follow, and the skip stays.
    const firstMovedAllDay = (rule: string, exdate: string) =>
      seriesRecurrenceForSave({
        editedStart: { date: "2026-11-03" },
        masterRecurrence: [rule, `EXDATE;TZID=America/New_York:${exdate}`],
        masterStart: { dateTime: "2026-11-02T09:00:00-05:00" },
        occurrence: {
          originalStartTime: { dateTime: "2026-11-02T09:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-02T09:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      });
    expect(
      firstMovedAllDay("RRULE:FREQ=WEEKLY;COUNT=5", "20261130T090000")
    ).toEqual(["RRULE:FREQ=WEEKLY;COUNT=5", "EXDATE;VALUE=DATE:20261201"]);
    expect(
      firstMovedAllDay("RRULE:FREQ=MONTHLY;COUNT=3", "20270102T090000")
    ).toEqual(["RRULE:FREQ=MONTHLY;COUNT=3", "EXDATE;VALUE=DATE:20270103"]);
  });

  test("counts from the series' own start time, not the occurrence's", () => {
    // 9:00 and 15:00 five times from Nov 9 9:00 (the fifth Nov 11 9:00,
    // skipped); the Nov 9 15:00 occurrence made all day for the series:
    // the client sends nothing, and the server counts from the series' own
    // 9:00, so Nov 11's only meeting stays skipped (three days).
    const recurrence = [
      "RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=5",
      "EXDATE;TZID=America/New_York:20261111T090000",
    ];
    expect(
      seriesRecurrenceForSave({
        editedStart: { date: "2026-11-09" },
        masterRecurrence: recurrence,
        masterStart: { dateTime: "2026-11-09T09:00:00-05:00" },
        occurrence: {
          originalStartTime: { dateTime: "2026-11-09T15:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-09T15:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      })
    ).toBeUndefined();
    expect(
      matchRecurrenceToStart(
        recurrence,
        { date: "2026-11-09" },
        "America/New_York",
        {
          dateTime: "2026-11-09T09:00:00-05:00",
        }
      )
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3", "EXDATE;VALUE=DATE:20261111"]);
  });

  test("names the series' first day for an occurrence's edit", () => {
    const masterStart = { dateTime: "2026-11-02T09:00:00-05:00" };
    expect(
      seriesCountingDays(
        { recurringEventId: "series" },
        masterStart,
        "America/New_York"
      )
    ).toEqual({
      firstDay: Temporal.PlainDate.from("2026-11-02"),
      firstTime: Temporal.PlainTime.from("09:00"),
      rulesFrom: Temporal.PlainDate.from("2026-11-02"),
      viaOccurrence: true,
    });
    // The series itself, or its master not loaded: the start is its own.
    expect(
      seriesCountingDays({}, masterStart, "America/New_York")
    ).toBeUndefined();
    expect(
      seriesCountingDays(
        { recurringEventId: "series" },
        null,
        "America/New_York"
      )
    ).toBeUndefined();
  });

  test("counts a COUNT from the series' first day", () => {
    // From Nov 2: daily 9:00, and 15:00 five times (Nov 2-6). Made all day
    // through the Nov 12 occurrence: the client sends nothing; the server,
    // from the series' first day, keeps Nov 9 (its only meeting skipped).
    const recurrence = [
      "RRULE:FREQ=DAILY;BYHOUR=9",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
      "EXDATE;TZID=America/New_York:20261109T090000",
    ];
    expect(
      seriesRecurrenceForSave({
        editedStart: { date: "2026-11-12" },
        masterRecurrence: recurrence,
        masterStart: { dateTime: "2026-11-02T09:00:00-05:00" },
        occurrence: {
          originalStartTime: { dateTime: "2026-11-12T09:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-12T09:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      })
    ).toBeUndefined();
    expect(
      matchRecurrenceToStart(
        recurrence,
        { date: "2026-11-02" },
        "America/New_York",
        {
          dateTime: "2026-11-02T09:00:00-05:00",
        }
      )
    ).toEqual([
      "RRULE:FREQ=DAILY",
      "RRULE:FREQ=DAILY;COUNT=5",
      "EXDATE;VALUE=DATE:20261109",
    ]);
  });

  describe("making a timed series all day", () => {
    const allDay = (recurrence: string[]) =>
      matchRecurrenceToStart(
        recurrence,
        { date: "2026-11-09" },
        "America/New_York",
        { dateTime: "2026-11-09T09:00:00-05:00" }
      );

    test("skips a whole day only when its meeting was skipped", () => {
      // Mondays 9:00: a stale 15:00 skip goes; Nov 16's 9:00 becomes its
      // date; the first meeting itself, deleted, stays deleted.
      expect(
        allDay([
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "EXDATE;TZID=America/New_York:20261109T150000,20261116T090000",
        ])
      ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20261116"]);
      expect(
        allDay([
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "EXDATE;TZID=America/New_York:20261109T090000",
        ])
      ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20261109"]);
    });

    test("drops a cancelled added meeting from both lists", () => {
      // An added, then cancelled, Mon Nov 16 15:00 adds nothing: as dates
      // it would skip Nov 16's regular meeting too.
      expect(
        allDay([
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261116T150000",
          "EXDATE;TZID=America/New_York:20261116T150000",
        ])
      ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
    });

    test("treats a skip at a rule's own time as the rule's", () => {
      // An added Nov 16 9:00 on top of the Monday 9:00 meeting, skipped:
      // that skip is the Monday meeting's, so Nov 16 stays skipped.
      expect(
        allDay([
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261116T090000",
          "EXDATE;TZID=America/New_York:20261116T090000",
        ])
      ).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;VALUE=DATE:20261116",
        "EXDATE;VALUE=DATE:20261116",
      ]);
    });

    test("doesn't count a rule that has ended as meeting", () => {
      // Daily 9:00, plus 15:00 until Nov 10 (by UNTIL or COUNT): Nov 16's
      // only meeting was skipped, so the day stays skipped.
      // (An UNTIL takes the all-day form, a date.)
      for (const [end, allDayEnd] of [
        ["UNTIL=20261110T200000Z", "UNTIL=20261110"],
        ["COUNT=2", "COUNT=2"],
      ]) {
        expect(
          allDay([
            "RRULE:FREQ=DAILY;BYHOUR=9",
            `RRULE:FREQ=DAILY;BYHOUR=15;${end}`,
            "EXDATE;TZID=America/New_York:20261116T090000",
          ])
        ).toEqual([
          "RRULE:FREQ=DAILY",
          `RRULE:FREQ=DAILY;${allDayEnd}`,
          "EXDATE;VALUE=DATE:20261116",
        ]);
      }
    });

    test("ends a rule at its UNTIL's moment, not its day", () => {
      // 15:00 until Nov 16 12:00 (17:00Z): Nov 16's 15:00 doesn't meet, so
      // its 9:00, skipped, was its only meeting.
      expect(
        allDay([
          "RRULE:FREQ=DAILY;BYHOUR=9",
          "RRULE:FREQ=DAILY;BYHOUR=15;UNTIL=20261116T170000Z",
          "EXDATE;TZID=America/New_York:20261116T090000",
        ])
      ).toEqual([
        "RRULE:FREQ=DAILY",
        "RRULE:FREQ=DAILY;UNTIL=20261116",
        "EXDATE;VALUE=DATE:20261116",
      ]);
    });

    test("takes a skipped added meeting as the rule's when its time is unknown", () => {
      // No start time to read the rule's from: an added Nov 16 9:00, also
      // skipped, may be the Monday meeting's, so Nov 16 stays skipped.
      expect(
        matchRecurrenceToStart(
          [
            "RRULE:FREQ=WEEKLY;BYDAY=MO",
            "RDATE;TZID=America/New_York:20261116T090000",
            "EXDATE;TZID=America/New_York:20261116T090000",
          ],
          { date: "2026-11-09" },
          "America/New_York"
        )
      ).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;VALUE=DATE:20261116",
        "EXDATE;VALUE=DATE:20261116",
      ]);
    });

    test("counts a several-a-day COUNT meeting by meeting", () => {
      // 9:00 and 15:00 five times from Nov 9 9:00: the fifth is Nov 11
      // 9:00, so that day's only meeting, skipped, keeps it skipped; and
      // the all-day rule keeps the series' three days (COUNT=3).
      expect(
        allDay([
          "RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=5",
          "EXDATE;TZID=America/New_York:20261111T090000",
        ])
      ).toEqual(["RRULE:FREQ=DAILY;COUNT=3", "EXDATE;VALUE=DATE:20261111"]);
    });

    test("doesn't count a time the clocks skip", () => {
      // 2:30 and 15:00 four times from Sat Mar 13 2027 2:30: Sun Mar 14
      // has no 2:30 (spring forward), so the four meetings take three days.
      expect(
        matchRecurrenceToStart(
          ["RRULE:FREQ=DAILY;BYHOUR=2,15;BYMINUTE=30;COUNT=4"],
          { date: "2027-03-13" },
          "America/New_York",
          { dateTime: "2027-03-13T02:30:00-05:00" }
        )
      ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
    });

    test("keeps a several-a-day day unless all its times were skipped", () => {
      // 9:00 and 15:00: only Nov 16's 15:00 skipped keeps Nov 16; both of
      // Nov 17's skipped skips the day. The rule loses its times.
      expect(
        allDay([
          "RRULE:FREQ=DAILY;BYHOUR=9,15",
          "EXDATE;TZID=America/New_York:20261116T150000,20261117T090000,20261117T150000",
        ])
      ).toEqual(["RRULE:FREQ=DAILY", "EXDATE;VALUE=DATE:20261117"]);
    });
  });

  test("keeps a retimed skip off another rule's real meeting", () => {
    // Mondays at the start's time plus Mondays fixed at 9:00 and 10:00,
    // Nov 16 9:00 skipped; the occurrence moved 9:00 -> 10:00 for the
    // series. The client sends nothing (the series keeps its rule), and
    // the server lines that rule up with the new start: the 9:00 skip
    // stays, and the fixed 10:00 meeting isn't hidden.
    const rules = [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,10;BYMINUTE=0",
      "EXDATE;TZID=America/New_York:20261116T090000",
    ];
    expect(
      matchRecurrenceToStart(
        rules,
        { dateTime: "2026-11-09T10:00:00-05:00" },
        "America/New_York",
        { dateTime: "2026-11-09T09:00:00-05:00" }
      )
    ).toEqual(rules);
    expect(
      seriesRecurrenceForSave({
        editedStart: { dateTime: "2026-11-09T10:00:00-05:00" },
        masterRecurrence: rules,
        occurrence: {
          originalStartTime: { dateTime: "2026-11-09T09:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-09T09:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      })
    ).toBeUndefined();
  });

  test("carries the series' rule with a moved occurrence", () => {
    expect(after()).toEqual(["RRULE:FREQ=MONTHLY;BYDAY=2SA"]);
  });

  test("gives the series' end the form its start takes", () => {
    const rule = ["RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z"];
    const save = (editedStart: { date?: string; dateTime?: string }) =>
      seriesRecurrenceForSave({
        editedStart,
        masterRecurrence: rule,
        occurrence: {
          originalStartTime: { dateTime: "2026-11-07T16:00:00-05:00" },
          recurringEventId: "series",
          start: { dateTime: "2026-11-07T16:00:00-05:00" },
        },
        recurrence: undefined,
        timeZone: "America/New_York",
      });
    // Made all day in place, or unchanged: the client sends nothing, and
    // the server gives the series' own end the date form.
    expect(save({ date: "2026-11-07" })).toBeUndefined();
    expect(save({ dateTime: "2026-11-07T16:00:00-05:00" })).toBeUndefined();
    expect(
      matchRecurrenceToStart(rule, { date: "2026-11-07" }, "America/New_York")
    ).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261205"]);
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

describe("occurrenceRepeatShown", () => {
  const weekly = ["RRULE:FREQ=WEEKLY;BYDAY=SU"];

  test("a usable rule shows the form's", () => {
    expect(
      occurrenceRepeatShown({
        edited: false,
        recurrence: weekly,
        seriesRecurrence: ["RRULE:FREQ=DAILY"],
        unusable: false,
      })
    ).toEqual({ loading: false, rules: weekly });
  });

  test("a reopened editor shows the series' cached rule while it can't be used", () => {
    expect(
      occurrenceRepeatShown({
        edited: false,
        recurrence: [],
        seriesRecurrence: weekly,
        unusable: true,
      })
    ).toEqual({ loading: true, rules: weekly });
  });

  test("with nothing cached it's loading, not 'doesn't repeat'", () => {
    expect(
      occurrenceRepeatShown({
        edited: false,
        recurrence: [],
        seriesRecurrence: undefined,
        unusable: true,
      })
    ).toEqual({ loading: true, rules: [] });
  });

  test("a repeat the user turned off stays off while the series refreshes", () => {
    expect(
      occurrenceRepeatShown({
        edited: true,
        recurrence: [],
        seriesRecurrence: weekly,
        unusable: true,
      })
    ).toEqual({ loading: false, rules: [] });
  });
});

describe("repeatCountingDay", () => {
  const zone = "America/New_York";
  const sunday = {
    originalStartTime: {
      dateTime: "2026-11-08T16:00:00-05:00",
      timeZone: zone,
    },
    recurringEventId: "m1",
  };
  const tuesday = Temporal.PlainDate.from("2026-11-10");

  test("a moved occurrence's unchanged repeat counts from its series' day", () => {
    // Sunday's meeting, moved to Tuesday: "weekly" is still on Sundays.
    expect(
      repeatCountingDay({
        changed: false,
        event: sunday,
        formDay: tuesday,
        timeZone: zone,
      })?.toString()
    ).toBe("2026-11-08");
  });

  test("a changed repeat set back counts from the series' day again", () => {
    // Moved to Tuesday, set to every 2 weeks, then back to weekly: the rule
    // equals the series' (nothing is sent), so it's still on Sundays.
    expect(
      repeatCountingDay({
        changed: false,
        event: sunday,
        formDay: tuesday,
        timeZone: zone,
      })?.toString()
    ).toBe("2026-11-08");
  });

  test("a moved occurrence's changed repeat counts from the moved day", () => {
    // The only save left starts a new series on Tuesday.
    expect(
      repeatCountingDay({
        changed: true,
        event: sunday,
        formDay: tuesday,
        timeZone: zone,
      })?.toString()
    ).toBe("2026-11-10");
  });

  test("an all-day occurrence's day is its date", () => {
    expect(
      repeatCountingDay({
        changed: false,
        event: {
          originalStartTime: { date: "2026-11-30" },
          recurringEventId: "m1",
        },
        formDay: tuesday,
        timeZone: zone,
      })?.toString()
    ).toBe("2026-11-30");
  });

  test("counts in the series' zone", () => {
    // 20:00 Sunday in New York is Monday in Tokyo.
    expect(
      repeatCountingDay({
        changed: false,
        event: {
          originalStartTime: { dateTime: "2026-11-08T20:00:00-05:00" },
          recurringEventId: "m1",
        },
        formDay: null,
        timeZone: "Asia/Tokyo",
      })?.toString()
    ).toBe("2026-11-09");
  });

  test("an added (RDATE) meeting counts from the series' first day", () => {
    // A Sunday weekly series with a Tuesday added: still weekly on Sunday.
    expect(
      repeatCountingDay({
        changed: false,
        event: {
          originalStartTime: { dateTime: "2026-11-10T16:00:00-05:00" },
          recurringEventId: "m1",
        },
        formDay: tuesday,
        seriesStart: { dateTime: "2026-10-04T16:00:00-04:00" },
        timeZone: zone,
      })?.toString()
    ).toBe("2026-10-04");
  });

  test("not an occurrence: the form's day", () => {
    expect(
      repeatCountingDay({
        changed: false,
        event: null,
        formDay: tuesday,
        timeZone: zone,
      })?.toString()
    ).toBe("2026-11-10");
  });
});

describe("repeatSkipsOccurrence", () => {
  // Whether Entire series would skip it, for any reason.
  const skipped = (params: Parameters<typeof repeatSkipsOccurrence>[0]) =>
    repeatSkipsOccurrence(params) !== null;
  const zone = "America/New_York";
  // The series started Sun Nov 1; this is its Sunday Nov 15 meeting.
  const seriesStart = { dateTime: "2026-11-01T16:00:00-05:00" };
  const later = {
    originalStartTime: { dateTime: "2026-11-15T16:00:00-05:00" },
    recurringEventId: "m1",
    start: { dateTime: "2026-11-15T16:00:00-05:00" },
  };
  const off = (recurrence: string[], occurrence = later) =>
    skipped({
      editedStart: occurrence.start,
      occurrence,
      recurrence,
      seriesStart,
      timeZone: zone,
    });

  test("monthly on 'Day N' from a later date: the series would count from the 1st", () => {
    expect(off(["RRULE:FREQ=MONTHLY"])).toBe(true);
  });

  test("monthly on a picked weekday of the month applies as shown", () => {
    expect(off(["RRULE:FREQ=MONTHLY;BYDAY=3SU"])).toBe(false);
  });

  test("weekly from a meeting on the series' weekday applies as shown", () => {
    expect(off(["RRULE:FREQ=WEEKLY;INTERVAL=2"])).toBe(false);
  });

  test("weekly with no days from a meeting on another weekday doesn't", () => {
    const tuesday = {
      ...later,
      start: { dateTime: "2026-11-17T16:00:00-05:00" },
    };
    expect(off(["RRULE:FREQ=WEEKLY;INTERVAL=2"], tuesday)).toBe(true);
    expect(off(["RRULE:FREQ=WEEKLY;BYDAY=TU"], tuesday)).toBe(false);
  });

  test("an interval counted from the first meeting that skips this one", () => {
    // Every 2 weeks from Nov 1 meets Nov 1, 15, 29: not Nov 8.
    const nov8 = {
      ...later,
      originalStartTime: { dateTime: "2026-11-08T16:00:00-05:00" },
      start: { dateTime: "2026-11-08T16:00:00-05:00" },
    };
    expect(off(["RRULE:FREQ=WEEKLY;INTERVAL=2"], nov8)).toBe(true);
    expect(off(["RRULE:FREQ=WEEKLY;INTERVAL=2"])).toBe(false);
  });

  test("an end that, counted from the first meeting, is already past", () => {
    const old = { dateTime: "2025-01-05T16:00:00-05:00" };
    const today = (recurrence: string[]) =>
      skipped({
        editedStart: later.start,
        occurrence: later,
        recurrence,
        seriesStart: old,
        timeZone: zone,
      });
    // Ten Sundays from Jan 5 2025 end in March 2025.
    expect(today(["RRULE:FREQ=WEEKLY;COUNT=10"])).toBe(true);
    expect(
      repeatSkipsOccurrence({
        editedStart: later.start,
        occurrence: later,
        recurrence: ["RRULE:FREQ=WEEKLY;COUNT=10"],
        seriesStart: old,
        timeZone: zone,
      })
    ).toBe("end");
    expect(today(["RRULE:FREQ=WEEKLY;COUNT=200"])).toBe(false);
    expect(today(["RRULE:FREQ=WEEKLY;UNTIL=20251231T235959Z"])).toBe(true);
    expect(today(["RRULE:FREQ=WEEKLY;UNTIL=20270131T235959Z"])).toBe(false);
  });

  test("a COUNT that meets several times a day counts each meeting", () => {
    // Daily at 9:00 and 16:00 from Nov 1 16:00: Nov 1 16:00, Nov 2 9:00,
    // Nov 2 16:00, Nov 3 9:00, then Nov 3 16:00 (this one) fifth.
    const nov3 = {
      ...later,
      originalStartTime: { dateTime: "2026-11-03T16:00:00-05:00" },
      start: { dateTime: "2026-11-03T16:00:00-05:00" },
    };
    const ends = (count: number) =>
      repeatSkipsOccurrence({
        editedStart: nov3.start,
        occurrence: nov3,
        recurrence: [`RRULE:FREQ=DAILY;BYHOUR=9,16;COUNT=${count}`],
        seriesStart,
        timeZone: zone,
      });
    expect(ends(3)).toBe("end");
    // Its 9:00 meeting that day is the fourth: still before this one.
    expect(ends(4)).toBe("end");
    expect(ends(5)).toBeNull();
  });

  test("a COUNT counts from the series' own time when this one keeps its time", () => {
    // From Nov 1 9:00 at 9:00 and 16:00: Nov 1 9:00, Nov 1 16:00, Nov 2
    // 9:00, Nov 2 16:00, Nov 3 9:00. Entire series keeps the 9:00 start, so
    // five end before Nov 3 16:00 (six reach it).
    const nineAm = { dateTime: "2026-11-01T09:00:00-05:00" };
    const nov3 = {
      ...later,
      originalStartTime: { dateTime: "2026-11-03T16:00:00-05:00" },
      start: { dateTime: "2026-11-03T16:00:00-05:00" },
    };
    const ends = (count: number, editedStart = nov3.start) =>
      repeatSkipsOccurrence({
        editedStart,
        occurrence: nov3,
        recurrence: [`RRULE:FREQ=DAILY;BYHOUR=9,16;COUNT=${count}`],
        seriesStart: nineAm,
        timeZone: zone,
      });
    expect(ends(5)).toBe("end");
    expect(ends(6)).toBeNull();
    // A new time moves the series' start to it (16:00 on Nov 1), so Nov 1
    // 9:00 isn't a meeting: Nov 3 16:00 is the fifth.
    const retimed = { dateTime: "2026-11-03T16:00:00-05:00" };
    expect(
      repeatSkipsOccurrence({
        editedStart: retimed,
        occurrence: {
          ...nov3,
          start: { dateTime: "2026-11-03T15:00:00-05:00" },
        },
        recurrence: ["RRULE:FREQ=DAILY;BYHOUR=9,16;COUNT=5"],
        seriesStart: nineAm,
        timeZone: zone,
      })
    ).toBeNull();
  });

  test("a COUNT that ends first counting from either time the save may keep", () => {
    // From Nov 1 16:00 at 9:00 and 16:00, its Nov 4 9:00 meeting kept at
    // 9:00. A new end moves the series' start to 9:00 too (the start
    // alone doesn't say), and six meetings from Nov 1 9:00 end Nov 3 16:00.
    const nov4 = {
      ...later,
      originalStartTime: { dateTime: "2026-11-04T09:00:00-05:00" },
      start: { dateTime: "2026-11-04T09:00:00-05:00" },
    };
    expect(
      repeatSkipsOccurrence({
        editedStart: nov4.start,
        occurrence: nov4,
        recurrence: ["RRULE:FREQ=DAILY;BYHOUR=9,16;COUNT=6"],
        seriesStart,
        timeZone: zone,
      })
    ).toBe("end");
  });

  test("yearly with only its month picked still takes its day from the first meeting", () => {
    // BYMONTH=11 from Nov 1 meets Nov 1 each year: not Nov 15.
    expect(off(["RRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=11"])).toBe(true);
    expect(off(["RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=15"])).toBe(false);
  });

  test("daily, or no repeat, never", () => {
    expect(off(["RRULE:FREQ=DAILY"])).toBe(false);
    expect(off([])).toBe(false);
  });

  test("before the series loads, can't tell (Entire series waits for it)", () => {
    expect(
      skipped({
        editedStart: later.start,
        occurrence: later,
        recurrence: ["RRULE:FREQ=MONTHLY"],
        timeZone: zone,
      })
    ).toBe(false);
  });
});

describe("untilDefaultDay", () => {
  const zone = "America/New_York";

  test("three months after a day still ahead", () => {
    const ahead = Temporal.Now.plainDateISO(zone).add({ days: 10 });
    expect(untilDefaultDay(ahead, zone).toString()).toBe(
      ahead.add({ months: 3 }).toString()
    );
  });

  test("a series' first day long past counts from today", () => {
    expect(
      untilDefaultDay(Temporal.PlainDate.from("2024-01-07"), zone).toString()
    ).toBe(Temporal.Now.plainDateISO(zone).add({ months: 3 }).toString());
  });
});

describe("repeatEndsBeforeStart", () => {
  const zone = "America/New_York";
  const rule = ["RRULE:FREQ=WEEKLY;UNTIL=20261117T045959Z"];
  const on = (iso: string) => Temporal.PlainDate.from(iso);

  test("an end picked, then the start moved past it", () => {
    expect(
      repeatEndsBeforeStart({
        recurrence: rule,
        sent: true,
        startDay: on("2026-11-23"),
        timeZone: zone,
      })?.toString()
    ).toBe("2026-11-16");
  });

  test("its own day, or a repeat the save doesn't send, is fine", () => {
    expect(
      repeatEndsBeforeStart({
        recurrence: rule,
        sent: true,
        startDay: on("2026-11-16"),
        timeZone: zone,
      })
    ).toBe(null);
    expect(
      repeatEndsBeforeStart({
        recurrence: rule,
        sent: false,
        startDay: on("2026-11-23"),
        timeZone: zone,
      })
    ).toBe(null);
  });
});
