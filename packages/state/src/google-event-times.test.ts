import { expect, test } from "bun:test";
import {
  keepsEventTimes,
  sameEventTime,
  withEditedTime,
} from "./google-event-times";

test("an edited time replaces the source's date form, keeping its zone", () => {
  const timed = {
    dateTime: "2026-11-10T09:00:00-05:00",
    timeZone: "America/New_York",
  };
  expect(withEditedTime(timed, { date: "2026-11-10" })).toEqual({
    date: "2026-11-10",
    timeZone: "America/New_York",
  });
  expect(
    withEditedTime(
      { date: "2026-11-10" },
      {
        dateTime: "2026-11-10T14:00:00.000Z",
      }
    )
  ).toEqual({ dateTime: "2026-11-10T14:00:00.000Z" });
});

test("reads two times as the same moment however they're written", () => {
  const zone = "America/New_York";
  const google = { dateTime: "2026-11-16T10:00:00-05:00" };
  // The editors' toISOString() form.
  expect(
    sameEventTime({ dateTime: "2026-11-16T15:00:00.000Z" }, google, zone)
  ).toBe(true);
  // No offset: read in its own zone, else the one given.
  expect(
    sameEventTime(
      { dateTime: "2026-11-16T10:00:00", timeZone: "America/New_York" },
      google,
      "Asia/Tokyo"
    )
  ).toBe(true);
  expect(sameEventTime({ dateTime: "2026-11-16T10:00:00" }, google, zone)).toBe(
    true
  );
  expect(
    sameEventTime({ dateTime: "2026-11-16T10:00:00-08:00" }, google, zone)
  ).toBe(false);
  // A date is its date, never a moment.
  expect(
    sameEventTime({ date: "2026-11-16" }, { date: "2026-11-16" }, zone)
  ).toBe(true);
  expect(sameEventTime({ date: "2026-11-16" }, google, zone)).toBe(false);
  expect(sameEventTime(undefined, google, zone)).toBe(false);
});

test("an edit keeps an occurrence's times only with its start and end both", () => {
  const zone = "America/New_York";
  const occurrence = {
    end: { dateTime: "2026-11-16T10:30:00-05:00" },
    start: { dateTime: "2026-11-16T10:00:00-05:00" },
  };
  expect(keepsEventTimes(occurrence, occurrence, zone)).toBe(true);
  expect(
    keepsEventTimes(
      { ...occurrence, end: { dateTime: "2026-11-16T11:00:00-05:00" } },
      occurrence,
      zone
    )
  ).toBe(false);
});
