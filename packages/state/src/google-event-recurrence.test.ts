import { describe, expect, test } from "bun:test";
import { describeEventRecurrence } from "./google-event-recurrence";

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
