import { describe, expect, test } from "bun:test";
import { seriesTimesForEdit } from "@kompose/google-cal/series-times";

const zone = "America/New_York";

describe("seriesTimesForEdit", () => {
  // A series begun Tue Oct 6 at 9:00 EDT (before the clocks change).
  const masterStart = { dateTime: "2026-10-06T09:00:00-04:00", timeZone: zone };
  const masterEnd = { dateTime: "2026-10-06T09:30:00-04:00", timeZone: zone };

  test("a rename leaves the series' times alone", () => {
    // A title edit through a 9:00 EST occurrence, sent in UTC.
    expect(
      seriesTimesForEdit({
        editedEnd: { dateTime: "2026-11-10T14:30:00.000Z", timeZone: zone },
        editedStart: { dateTime: "2026-11-10T14:00:00.000Z", timeZone: zone },
        masterEnd,
        masterStart,
        occurrenceEnd: { dateTime: "2026-11-10T14:30:00.000Z", timeZone: zone },
        occurrenceStart: {
          dateTime: "2026-11-10T14:00:00.000Z",
          timeZone: zone,
        },
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
        occurrenceEnd: { dateTime: "2026-11-10T14:30:00.000Z", timeZone: zone },
        occurrenceStart: {
          dateTime: "2026-11-10T14:00:00.000Z",
          timeZone: zone,
        },
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
        occurrenceEnd: { dateTime: "2026-11-10T14:30:00.000Z", timeZone: zone },
        occurrenceStart: {
          dateTime: "2026-11-10T14:00:00.000Z",
          timeZone: zone,
        },
      })
    ).toEqual({ end: { date: "2026-10-07" }, start: { date: "2026-10-06" } });
    expect(
      seriesTimesForEdit({
        editedEnd: { dateTime: "2026-11-10T15:00:00.000Z", timeZone: zone },
        editedStart: { dateTime: "2026-11-10T14:00:00.000Z", timeZone: zone },
        masterEnd: { date: "2026-10-07" },
        masterStart: { date: "2026-10-06" },
        occurrenceEnd: { date: "2026-11-11" },
        occurrenceStart: { date: "2026-11-10" },
      })
    ).toEqual({
      end: { dateTime: "2026-10-06T10:00:00-04:00", timeZone: zone },
      start: { dateTime: "2026-10-06T09:00:00-04:00", timeZone: zone },
    });
  });

  test("leaves the series' times alone when the edit didn't change them", () => {
    // An occurrence rescheduled to 14:00 before, now only renamed.
    const rescheduledStart = {
      dateTime: "2026-11-10T19:00:00.000Z",
      timeZone: zone,
    };
    const rescheduledEnd = {
      dateTime: "2026-11-10T19:30:00.000Z",
      timeZone: zone,
    };
    expect(
      seriesTimesForEdit({
        editedEnd: rescheduledEnd,
        editedStart: rescheduledStart,
        masterEnd,
        masterStart,
        occurrenceEnd: rescheduledEnd,
        occurrenceStart: rescheduledStart,
      })
    ).toEqual({ end: masterEnd, start: masterStart });
  });

  test("reads the edit's offset when no zone comes with it", () => {
    // An all-day series made 9:00 at -05:00, with no time zone sent.
    expect(
      seriesTimesForEdit({
        editedEnd: { dateTime: "2026-11-10T10:00:00-05:00" },
        editedStart: { dateTime: "2026-11-10T09:00:00-05:00" },
        masterEnd: { date: "2026-10-07" },
        masterStart: { date: "2026-10-06" },
        occurrenceEnd: { date: "2026-11-11" },
        occurrenceStart: { date: "2026-11-10" },
      })
    ).toEqual({
      end: { dateTime: "2026-10-06T10:00:00-05:00" },
      start: { dateTime: "2026-10-06T09:00:00-05:00" },
    });
  });

  test("reads a dateTime without an offset in its zone", () => {
    expect(
      seriesTimesForEdit({
        editedEnd: { dateTime: "2026-11-10T11:00:00", timeZone: zone },
        editedStart: { dateTime: "2026-11-10T10:00:00", timeZone: zone },
        masterEnd,
        masterStart,
        occurrenceEnd: { dateTime: "2026-11-10T14:30:00.000Z", timeZone: zone },
        occurrenceStart: {
          dateTime: "2026-11-10T14:00:00.000Z",
          timeZone: zone,
        },
      })
    ).toEqual({
      end: { dateTime: "2026-10-06T11:00:00-04:00", timeZone: zone },
      start: { dateTime: "2026-10-06T10:00:00-04:00", timeZone: zone },
    });
  });

  test("lengthens an all-day series with no zone anywhere", () => {
    // A one-day occurrence made two days long.
    expect(
      seriesTimesForEdit({
        editedEnd: { date: "2026-11-12" },
        editedStart: { date: "2026-11-10" },
        masterEnd: { date: "2026-10-07" },
        masterStart: { date: "2026-10-06" },
        occurrenceEnd: { date: "2026-11-11" },
        occurrenceStart: { date: "2026-11-10" },
      })
    ).toEqual({ end: { date: "2026-10-08" }, start: { date: "2026-10-06" } });
  });

  test("keeps a series in its own zone when edited from another", () => {
    // A Tuesday 9:00 Tokyo series, moved to 10:00 from New York.
    const tokyo = "Asia/Tokyo";
    expect(
      seriesTimesForEdit({
        editedEnd: { dateTime: "2026-11-10T01:30:00.000Z", timeZone: zone },
        editedStart: { dateTime: "2026-11-10T01:00:00.000Z", timeZone: zone },
        masterEnd: { dateTime: "2026-10-06T09:30:00+09:00", timeZone: tokyo },
        masterStart: { dateTime: "2026-10-06T09:00:00+09:00", timeZone: tokyo },
        occurrenceEnd: {
          dateTime: "2026-11-10T09:30:00+09:00",
          timeZone: tokyo,
        },
        occurrenceStart: {
          dateTime: "2026-11-10T09:00:00+09:00",
          timeZone: tokyo,
        },
      })
    ).toEqual({
      end: { dateTime: "2026-10-06T10:30:00+09:00", timeZone: tokyo },
      start: { dateTime: "2026-10-06T10:00:00+09:00", timeZone: tokyo },
    });
  });

  test("an edit written in another zone without an offset keeps its moment", () => {
    // 09:00 in Tokyo on Nov 11 is 19:00 New York on Nov 10, the same
    // whether it's written with its offset or without one.
    const occurrenceStart = {
      dateTime: "2026-11-10T09:00:00-05:00",
      timeZone: zone,
    };
    const occurrenceEnd = {
      dateTime: "2026-11-10T09:30:00-05:00",
      timeZone: zone,
    };
    const edit = (start: string, end: string) =>
      seriesTimesForEdit({
        editedEnd: { dateTime: end, timeZone: "Asia/Tokyo" },
        editedStart: { dateTime: start, timeZone: "Asia/Tokyo" },
        masterEnd,
        masterStart,
        occurrenceEnd,
        occurrenceStart,
      });
    const withOffset = edit(
      "2026-11-11T09:00:00+09:00",
      "2026-11-11T09:30:00+09:00"
    );
    expect(edit("2026-11-11T09:00:00", "2026-11-11T09:30:00")).toEqual(
      withOffset
    );
    expect(withOffset?.start).toEqual({
      dateTime: "2026-10-06T19:00:00-04:00",
      timeZone: zone,
    });
  });
});
