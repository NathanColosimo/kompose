import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  describeEventRecurrence,
  monthlyDayOptions,
} from "./event-recurrence-words";
import { parseGoogleEventRecurrenceRule } from "./google-event-recurrence";

describe("repeat descriptions", () => {
  test("names implicit weekdays and explicit monthly positions", () => {
    expect(
      describeEventRecurrence({
        rules: ["RRULE:FREQ=WEEKLY"],
        start: Temporal.PlainDate.from("2026-11-07"),
      })
    ).toBe("Repeats every week on Saturday");
    expect(
      describeEventRecurrence({
        rules: ["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU"],
      })
    ).toBe("Repeats every 2 months on 2nd Tuesday");
  });

  test("includes the end when requested, in the series' timezone", () => {
    expect(
      describeEventRecurrence({
        rules: ["RRULE:FREQ=DAILY;COUNT=5"],
        timeZone: "UTC",
      })
    ).toBe("Repeats every day for 5 times");
    expect(
      describeEventRecurrence({
        rules: ["RRULE:FREQ=DAILY;UNTIL=20270211T020000Z"],
        timeZone: "America/New_York",
      })
    ).toContain("February 10, 2027");
    expect(
      describeEventRecurrence({ rules: ["RRULE:FREQ=DAILY;COUNT=5"] })
    ).toBe("Repeats every day");
  });

  test("marks additional rules and dates as custom", () => {
    expect(
      describeEventRecurrence({
        rules: ["RRULE:FREQ=WEEKLY", "RDATE:20261111"],
      })
    ).toEndWith(" (custom)");
    expect(describeEventRecurrence({ rules: ["RRULE:FREQ=UNKNOWN"] })).toBe(
      "Repeats (custom)"
    );
  });

  test("distinguishes a missing master from a one-off event", () => {
    expect(
      describeEventRecurrence({ rules: [], recurringEventId: "series" })
    ).toBe("Repeats");
    expect(describeEventRecurrence({ rules: [], eventType: "birthday" })).toBe(
      "Repeats yearly"
    );
    expect(describeEventRecurrence({ rules: [] })).toBeNull();
  });
});

describe("monthly choices", () => {
  const choices = (rule: string, date = "2026-11-07") =>
    monthlyDayOptions(
      parseGoogleEventRecurrenceRule(rule),
      rule,
      Temporal.PlainDate.from(date)
    );

  test("offers the start's day and weekday, including a last weekday", () => {
    expect(choices("RRULE:FREQ=MONTHLY").map((x) => x.label)).toEqual([
      "Day 7",
      "The 1st Sat",
    ]);
    expect(
      choices("RRULE:FREQ=MONTHLY;BYDAY=-1FR", "2026-11-27")
        .filter((x) => x.selected)
        .map((x) => x.label)
    ).toEqual(["The last Fri"]);
  });

  test("keeps an imported day expression when its matching choice is selected", () => {
    const selected = choices("RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1").find(
      (x) => x.selected
    );
    expect(selected?.byDay).toEqual(["SA"]);
    expect(selected?.monthDays).toEqual([]);
  });

  test("keeps a custom rule as its own selected choice", () => {
    const selected = choices("RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15")[0];
    expect(selected?.selected).toBe(true);
    expect(selected?.monthDays).toEqual(["1", "15"]);
    expect(selected?.label).toContain("1st");
    expect(selected?.label).toContain("15th");
  });
});
