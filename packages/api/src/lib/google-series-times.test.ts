import { describe, expect, test } from "bun:test";
import { seriesTimesForEdit } from "@kompose/google-cal/series-times";

const zone = "America/New_York";

describe("seriesTimesForEdit", () => {
  // A series begun Tue Oct 6 at 9:00 EDT (before the clocks change).
  const masterStart = { dateTime: "2026-10-06T09:00:00-04:00", timeZone: zone };
  const masterEnd = { dateTime: "2026-10-06T09:30:00-04:00", timeZone: zone };

  test("keeps the series' first day and wall-clock time across a DST change", () => {
    // A title edit through a 9:00 EST occurrence, sent in UTC.
    expect(
      seriesTimesForEdit({
        editedEnd: { dateTime: "2026-11-10T14:30:00.000Z", timeZone: zone },
        editedStart: { dateTime: "2026-11-10T14:00:00.000Z", timeZone: zone },
        masterEnd,
        masterStart,
      })
    ).toEqual({
      end: { dateTime: "2026-10-06T09:30:00-04:00", timeZone: zone },
      start: { dateTime: "2026-10-06T09:00:00-04:00", timeZone: zone },
    });
  });

  test("takes an edited time and length on the series' first day", () => {
    expect(
      seriesTimesForEdit({
        editedEnd: { dateTime: "2026-11-10T16:00:00.000Z", timeZone: zone },
        editedStart: { dateTime: "2026-11-10T15:00:00.000Z", timeZone: zone },
        masterEnd,
        masterStart,
      })
    ).toEqual({
      end: { dateTime: "2026-10-06T11:00:00-04:00", timeZone: zone },
      start: { dateTime: "2026-10-06T10:00:00-04:00", timeZone: zone },
    });
  });

  test("follows an occurrence made all day, and back", () => {
    expect(
      seriesTimesForEdit({
        editedEnd: { date: "2026-11-11" },
        editedStart: { date: "2026-11-10" },
        masterEnd,
        masterStart,
      })
    ).toEqual({ end: { date: "2026-10-07" }, start: { date: "2026-10-06" } });
    expect(
      seriesTimesForEdit({
        editedEnd: { dateTime: "2026-11-10T15:00:00.000Z", timeZone: zone },
        editedStart: { dateTime: "2026-11-10T14:00:00.000Z", timeZone: zone },
        masterEnd: { date: "2026-10-07" },
        masterStart: { date: "2026-10-06" },
      })
    ).toEqual({
      end: { dateTime: "2026-10-06T10:00:00-04:00", timeZone: zone },
      start: { dateTime: "2026-10-06T09:00:00-04:00", timeZone: zone },
    });
  });
});
