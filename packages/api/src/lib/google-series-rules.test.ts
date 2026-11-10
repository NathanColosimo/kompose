import { describe, expect, test } from "bun:test";
import { isRuleDay } from "@kompose/google-cal/series";
import { Temporal } from "temporal-polyfill";

// Whether a day is one of a rule's days, as Google reads the rule: the
// apps use it to rebuild a repeat for a new day.

describe("isRuleDay", () => {
  const day = (iso: string) => Temporal.PlainDate.from(iso);

  test("reads the rule parts the editors write", () => {
    const start = day("2026-11-02");
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;BYDAY=MO,WE", start, day("2026-11-11"))
    ).toBe(true);
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;BYDAY=MO,WE", start, day("2026-11-10"))
    ).toBe(false);
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;INTERVAL=2", start, day("2026-11-09"))
    ).toBe(false);
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;INTERVAL=2", start, day("2026-11-16"))
    ).toBe(true);
    expect(
      isRuleDay("RRULE:FREQ=MONTHLY;BYDAY=-1FR", start, day("2026-11-27"))
    ).toBe(true);
    expect(
      isRuleDay("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1", start, day("2026-11-30"))
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
        start,
        day("2027-11-25")
      )
    ).toBe(true);
    // Every BY part narrows the set: Friday the 13th; a yearly day of the
    // month in every month; a weekly rule kept to the 1st.
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13",
        start,
        day("2027-08-13")
      )
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13",
        start,
        day("2026-12-13")
      )
    ).toBe(false);
    expect(
      isRuleDay("RRULE:FREQ=YEARLY;BYMONTHDAY=1", start, day("2027-02-01"))
    ).toBe(true);
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;BYMONTHDAY=1", start, day("2027-01-08"))
    ).toBe(false);
    // BYSETPOS: the 2nd Tuesday, and the last weekday.
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2",
        start,
        day("2026-12-08")
      )
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
        start,
        day("2026-11-30")
      )
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
        start,
        day("2026-11-27")
      )
    ).toBe(false);
    // A day of the year: the 100th of 2027 is Apr 10.
    expect(
      isRuleDay("RRULE:FREQ=YEARLY;BYYEARDAY=100", start, day("2027-04-10"))
    ).toBe(true);
    // A rule that can't be read: can't tell.
    expect(
      isRuleDay("RRULE:FREQ=FORTNIGHTLY", start, day("2026-11-16"))
    ).toBeNull();
    // Its end is left out: a meeting day past COUNT is still a rule day.
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1", start, day("2026-11-30"))
    ).toBe(true);
    // A list of times still meets on the rule's days: Google ignores the
    // list and meets once a day.
    expect(
      isRuleDay(
        "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15",
        start,
        day("2026-11-16")
      )
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15",
        start,
        day("2026-11-17")
      )
    ).toBe(false);
    // Google ignores a list of times, so BYSETPOS picks among days.
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=MO;BYHOUR=9,15;BYSETPOS=1",
        start,
        day("2026-12-07")
      )
    ).toBe(true);
  });
});
