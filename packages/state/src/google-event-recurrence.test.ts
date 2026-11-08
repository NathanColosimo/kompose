import { describe, expect, test } from "bun:test";
import {
  buildGoogleEventRecurrenceRule,
  describeEventRecurrence,
  getPrimaryRecurrenceRule,
  setPrimaryRecurrenceRule,
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
  const biweekly = "RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=TU";

  test("keeps the parts an edit doesn't set", () => {
    // "Ends after 10" on an every-2-weeks series stays every 2 weeks.
    expect(
      buildGoogleEventRecurrenceRule(
        "WEEKLY",
        ["TU"],
        { count: 10, type: "count" },
        biweekly
      )
    ).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=TU;COUNT=10");
  });

  test("drops parts tied to a frequency when it changes", () => {
    expect(
      buildGoogleEventRecurrenceRule(
        "WEEKLY",
        ["MO"],
        { type: "none" },
        "RRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15"
      )
    ).toBe("RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=MO");
  });
});
