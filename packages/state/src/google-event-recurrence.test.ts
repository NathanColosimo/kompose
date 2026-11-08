import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  buildGoogleEventRecurrenceRule,
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
    expect(
      follow("RRULE:FREQ=WEEKLY;BYDAY=TU,WE", "2026-11-10", "2026-11-11")
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=WE");
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
