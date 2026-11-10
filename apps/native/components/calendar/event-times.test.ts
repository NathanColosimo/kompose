/// <reference types="bun" />

import { expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { draftTimes } from "./event-times";

const draft = {
  allDay: false,
  endDate: Temporal.PlainDate.from("2026-11-01"),
  endTime: Temporal.PlainTime.from("02:30"),
  startDate: Temporal.PlainDate.from("2026-11-01"),
  startTime: Temporal.PlainTime.from("01:30"),
};

test("an untouched event keeps the later instant in a repeated DST hour", () => {
  const times = draftTimes(draft, "America/New_York", "America/New_York", {
    start: { dateTime: "2026-11-01T01:30:00-05:00" },
    end: { dateTime: "2026-11-01T02:30:00-05:00" },
  });
  expect(times.start).toEqual({
    dateTime: "2026-11-01T06:30:00Z",
    timeZone: "America/New_York",
  });
  expect(times.end).toEqual({
    dateTime: "2026-11-01T07:30:00Z",
    timeZone: "America/New_York",
  });
});

test("an all-day save sends dates with an exclusive end", () => {
  expect(
    draftTimes({ ...draft, allDay: true }, "America/New_York", "Asia/Tokyo")
  ).toEqual({
    allDay: true,
    start: { date: "2026-11-01" },
    end: { date: "2026-11-02" },
  });
});
