import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  buildGoogleEventRecurrenceRule,
  type EventRecurrencePattern,
  getPrimaryRecurrenceRule,
  lastWeekdayOf,
  occurrenceRepeatShown,
  parseGoogleEventRecurrenceRule,
  pickRecurrenceFrequency,
  repeatChanged,
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
  test("round-trips a frequency the editor cannot show as custom", () => {
    const rule = "RRULE:FREQ=HOURLY;INTERVAL=3;BYMINUTE=15;COUNT=10";
    const pattern = parseGoogleEventRecurrenceRule(rule);
    expect(pattern.freq).toBe("custom");
    expect(buildGoogleEventRecurrenceRule(pattern, rule)).toBe(rule);
  });

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
        "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5;BYDAY=TU;WKST=SU",
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
      expect(edit(rule, endAfter5)?.slice(6).split(";").sort()).toEqual(
        expected.slice(6).split(";").sort()
      );
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
      expect(
        parseGoogleEventRecurrenceRule(
          pick(rule, parseGoogleEventRecurrenceRule(rule).freq) ?? undefined
        )
      ).toEqual(parseGoogleEventRecurrenceRule(rule));
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
    ).toBe("RRULE:FREQ=MONTHLY;COUNT=5;BYDAY=2TU;BYMONTHDAY=8,9,10");
  });
});

const day = (iso: string) => Temporal.PlainDate.from(iso);

describe("weekdays of the month", () => {
  test("name the last", () => {
    // Nov 27, 2026 is the 4th Friday and the last.
    expect(lastWeekdayOf(day("2026-11-27"))).toBe("-1FR");
    expect(lastWeekdayOf(day("2026-11-20"))).toBeNull();
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

describe("repeatChanged", () => {
  // Saved by another editor with its days Sunday first.
  const source = ["RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=SU,MO"];
  test("a repeat set back to the series' own reads as unchanged", () => {
    const pattern = parseGoogleEventRecurrenceRule(source[0]);
    const withCount = (count: number) => [
      buildGoogleEventRecurrenceRule(
        { ...pattern, end: { count, type: "count" } },
        source[0]
      ) ?? "",
    ];
    // Changed to 5 and back to 10: the rule is rebuilt with its parts and
    // days reordered.
    expect(withCount(10)).not.toEqual(source);
    expect(
      repeatChanged({ edited: true, recurrence: withCount(10), source })
    ).toBe(false);
    expect(
      repeatChanged({
        edited: true,
        recurrence: withCount(5),
        source,
      })
    ).toBe(true);
  });
});
