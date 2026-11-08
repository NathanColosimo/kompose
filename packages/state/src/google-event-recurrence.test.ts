import { describe, expect, test } from "bun:test";
import {
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
