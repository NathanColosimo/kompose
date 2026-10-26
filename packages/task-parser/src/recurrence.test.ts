import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { toTaskRecurrence } from "./recurrence";

const friday = Temporal.PlainDate.from("2026-10-23");
const rule = (body: string) => `DTSTART;VALUE=DATE:20261023\nRRULE:${body}`;

describe("toTaskRecurrence", () => {
  test.each([
    ["FREQ=DAILY;INTERVAL=1", { freq: "DAILY", interval: 1 }],
    ["FREQ=DAILY;INTERVAL=3", { freq: "DAILY", interval: 3 }],
    [
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR",
      { byDay: ["MO", "TU", "WE", "TH", "FR"], freq: "WEEKLY", interval: 1 },
    ],
    // No BYDAY: the weekday of the first occurrence.
    ["FREQ=WEEKLY;INTERVAL=2", { byDay: ["FR"], freq: "WEEKLY", interval: 2 }],
    [
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1",
      { byMonthDay: 1, freq: "MONTHLY", interval: 1 },
    ],
    [
      "FREQ=MONTHLY;INTERVAL=1",
      { byMonthDay: 23, freq: "MONTHLY", interval: 1 },
    ],
    [
      "FREQ=YEARLY;INTERVAL=1;BYMONTH=3;BYMONTHDAY=3",
      { freq: "YEARLY", interval: 1 },
    ],
    [
      "FREQ=DAILY;INTERVAL=1;UNTIL=20261105",
      { freq: "DAILY", interval: 1, until: "2026-11-05" },
    ],
    [
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=4",
      { byDay: ["TU"], count: 4, freq: "WEEKLY", interval: 1 },
    ],
  ])("%p", (body, expected) => {
    expect(toTaskRecurrence(rule(body), friday)).toEqual(expected as never);
  });

  test("a UTC end date is read in the user's zone", () => {
    // 23:59:59 on Dec 20 in New York.
    const body = "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;UNTIL=20261221T045959Z";
    expect(
      toTaskRecurrence(rule(body), friday, "America/New_York")?.until
    ).toBe("2026-12-20");
  });

  test.each([
    "FREQ=MONTHLY;INTERVAL=1;BYDAY=MO;BYSETPOS=1",
    "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15",
    "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1",
    "FREQ=MONTHLY;INTERVAL=1;BYDAY=FR",
    "FREQ=HOURLY;INTERVAL=1",
    "FREQ=DAILY;INTERVAL=1;BYMONTHDAY=15",
  ])("%p has no schema equivalent", (body) => {
    expect(toTaskRecurrence(rule(body), friday)).toBeNull();
  });
});
