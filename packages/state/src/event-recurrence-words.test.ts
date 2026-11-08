import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  describeEventRecurrence,
  monthlyDayOptions,
} from "./event-recurrence-words";
import { parseGoogleEventRecurrenceRule } from "./google-event-recurrence";

const words = (rule: string, start?: string) =>
  describeEventRecurrence({
    rules: [rule],
    start: start ? Temporal.PlainDate.from(start) : undefined,
  });

describe("describeEventRecurrence", () => {
  test("says how a series repeats", () => {
    expect(words("RRULE:FREQ=WEEKLY;BYDAY=MO,WE")).toBe(
      "Repeats weekly on Mon, Wed"
    );
    expect(words("RRULE:FREQ=DAILY;INTERVAL=2")).toBe("Repeats every 2 days");
    expect(words("RRULE:FREQ=YEARLY")).toBe("Repeats yearly");
    expect(words("RRULE:FREQ=HOURLY")).toBe("Repeats");
  });

  test("names the start's day when the rule doesn't", () => {
    // Nov 7, 2026 is a Saturday.
    expect(words("RRULE:FREQ=WEEKLY", "2026-11-07")).toBe(
      "Repeats weekly on Sat"
    );
    expect(words("RRULE:FREQ=WEEKLY;BYDAY=MO", "2026-11-07")).toBe(
      "Repeats weekly on Mon"
    );
    expect(words("RRULE:FREQ=MONTHLY", "2026-11-07")).toBe(
      "Repeats monthly on day 7"
    );
    expect(words("RRULE:FREQ=YEARLY", "2026-11-07")).toBe(
      "Repeats yearly on Nov 7"
    );
  });

  test("names the day of a monthly or yearly series", () => {
    expect(words("RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU")).toBe(
      "Repeats every 2 months on the 2nd Tue"
    );
    expect(words("RRULE:FREQ=MONTHLY;BYDAY=-1FR")).toBe(
      "Repeats monthly on the last Fri"
    );
    expect(words("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH")).toBe(
      "Repeats yearly on the 4th Thu of Nov"
    );
    expect(words("RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=15")).toBe(
      "Repeats yearly on Nov 15"
    );
    expect(words("RRULE:FREQ=MONTHLY;BYMONTHDAY=15")).toBe(
      "Repeats monthly on day 15"
    );
    expect(words("RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15")).toBe(
      "Repeats monthly on days 1, 15"
    );
    expect(words("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1")).toBe(
      "Repeats monthly on the last day"
    );
    expect(words("RRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2")).toBe(
      "Repeats monthly on the 2nd Mon"
    );
    expect(words("RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1")).toBe(
      "Repeats monthly on the last weekday"
    );
  });

  test("marks parts the words don't cover, instead of hiding them", () => {
    for (const [rule, said] of [
      // The 4th Thursday of the year, not of a month.
      ["RRULE:FREQ=YEARLY;BYDAY=4TH", "Repeats yearly (custom)"],
      ["RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR", "Repeats daily (custom)"],
      // Only in January and July.
      [
        "RRULE:FREQ=MONTHLY;BYMONTH=1,7;BYMONTHDAY=1",
        "Repeats monthly on day 1 (custom)",
      ],
      // Only a Friday the 15th.
      ["RRULE:FREQ=MONTHLY;BYMONTHDAY=15;BYDAY=FR", "Repeats monthly (custom)"],
      ["RRULE:FREQ=MONTHLY;BYMONTHDAY=-2", "Repeats monthly (custom)"],
      // Only the 1st Monday survives "BYSETPOS=1,3".
      [
        "RRULE:FREQ=MONTHLY;BYDAY=1MO,2MO;BYSETPOS=1,3",
        "Repeats monthly (custom)",
      ],
    ] as const) {
      expect(words(rule)).toBe(said);
    }
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

describe("monthlyDayOptions", () => {
  const options = (rule: string, start: string) =>
    monthlyDayOptions(
      parseGoogleEventRecurrenceRule(rule),
      rule,
      Temporal.PlainDate.from(start)
    ).map(({ label, selected }) => (selected ? `[${label}]` : label));

  test("offers the start's day, its weekday, and in its last week the last", () => {
    expect(options("RRULE:FREQ=MONTHLY", "2026-11-07")).toEqual([
      "[Day 7]",
      "The 1st Sat",
    ]);
    // Nov 27, 2026 is the 4th Friday and the last.
    expect(options("RRULE:FREQ=MONTHLY;BYDAY=-1FR", "2026-11-27")).toEqual([
      "Day 27",
      "The 4th Fri",
      "[The last Fri]",
    ]);
    // Dec 29, 2026 is the 5th Tuesday: only the last.
    expect(options("RRULE:FREQ=MONTHLY", "2026-12-29")).toEqual([
      "[Day 29]",
      "The last Tue",
    ]);
  });

  test("counts the start's own day, said another way, as that choice", () => {
    // Apple and Outlook write these.
    expect(options("RRULE:FREQ=MONTHLY;BYMONTHDAY=7", "2026-11-07")).toEqual([
      "[Day 7]",
      "The 1st Sat",
    ]);
    expect(
      options("RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1", "2026-11-07")
    ).toEqual(["Day 7", "[The 1st Sat]"]);
    // Picking the selected one keeps the rule's parts.
    const [day] = monthlyDayOptions(
      parseGoogleEventRecurrenceRule("RRULE:FREQ=MONTHLY;BYMONTHDAY=7"),
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=7",
      Temporal.PlainDate.from("2026-11-07")
    );
    expect(day?.monthDays).toEqual(["7"]);
  });

  test("keeps a rule set another way first, selected", () => {
    expect(options("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1", "2026-11-30")).toEqual([
      "[The last day]",
      "Day 30",
      "The last Mon",
    ]);
    expect(
      options(
        "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
        "2026-11-07"
      )
    ).toEqual(["[The last weekday]", "Day 7", "The 1st Sat"]);
    expect(options("RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15", "2026-11-07")).toEqual(
      ["[Days 1, 15]", "Day 7", "The 1st Sat"]
    );
    // The later of the 15th and the 30th isn't "Days 15, 30".
    expect(
      options("RRULE:FREQ=MONTHLY;BYMONTHDAY=15,30;BYSETPOS=-1", "2026-11-07")
    ).toEqual(["[Custom days]", "Day 7", "The 1st Sat"]);
  });
});
