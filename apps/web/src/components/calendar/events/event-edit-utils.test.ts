/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { repeatForSeries, seriesEdit } from "./event-edit-utils";

const zone = "America/New_York";
const at = (dateTime: string) => ({ dateTime, timeZone: zone });

/** A series and one of its occurrences, as Google returns them. */
function series({
  rule,
  first,
  firstEnd,
  slot,
  slotEnd,
}: {
  rule: string;
  first: string;
  firstEnd: string;
  slot: string;
  slotEnd: string;
}) {
  const master: GoogleEvent = {
    end: at(firstEnd),
    id: "sync",
    recurrence: [rule],
    start: at(first),
    summary: "Weekly sync",
  };
  const occurrence: GoogleEvent = {
    end: at(slotEnd),
    id: "sync_occurrence",
    originalStartTime: at(slot),
    recurringEventId: "sync",
    start: at(slot),
    summary: "Weekly sync",
  };
  return { master, occurrence };
}

describe("repeatForSeries", () => {
  const weekly = series({
    first: "2026-11-04T10:00:00-05:00",
    firstEnd: "2026-11-04T10:30:00-05:00",
    rule: "RRULE:FREQ=WEEKLY;BYDAY=WE",
    slot: "2026-11-11T10:00:00-05:00",
    slotEnd: "2026-11-11T10:30:00-05:00",
  });

  test("follows an occurrence moved to another weekday", () => {
    const shown = repeatForSeries({
      edited: false,
      editedStart: at("2026-11-12T10:00:00-05:00"),
      master: weekly.master,
      occurrence: weekly.occurrence,
      recurrence: weekly.master.recurrence ?? [],
      timeZone: zone,
    });
    expect(shown.followsMove).toBe(true);
    expect(shown.recurrence[0]).toContain("BYDAY=TH");
  });

  test("follows an occurrence moved to another day of the month", () => {
    const monthly = series({
      first: "2026-10-30T09:00:00-04:00",
      firstEnd: "2026-10-30T09:30:00-04:00",
      rule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=30",
      slot: "2026-11-30T09:00:00-05:00",
      slotEnd: "2026-11-30T09:30:00-05:00",
    });
    const shown = repeatForSeries({
      edited: false,
      editedStart: at("2026-11-29T09:00:00-05:00"),
      master: monthly.master,
      occurrence: monthly.occurrence,
      recurrence: monthly.master.recurrence ?? [],
      timeZone: zone,
    });
    expect(shown.recurrence[0]).toContain("BYMONTHDAY=29");
  });

  test("keeps the series' rule when the day doesn't move", () => {
    const rule = ["RRULE:FREQ=WEEKLY;BYDAY=WE"];
    const shown = repeatForSeries({
      edited: false,
      editedStart: at("2026-11-11T11:00:00-05:00"),
      master: weekly.master,
      occurrence: weekly.occurrence,
      recurrence: rule,
      timeZone: zone,
    });
    expect(shown).toEqual({ followsMove: false, recurrence: rule });
  });

  test("keeps a repeat the user set", () => {
    const own = ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"];
    const shown = repeatForSeries({
      edited: true,
      editedStart: at("2026-11-12T10:00:00-05:00"),
      master: weekly.master,
      occurrence: weekly.occurrence,
      recurrence: own,
      timeZone: zone,
    });
    expect(shown).toEqual({ followsMove: false, recurrence: own });
  });
});

describe("seriesEdit", () => {
  // Mondays 10:00-10:30; this one was rescheduled to Tue 11:00-12:00, and
  // renamed and given its own guest on its own.
  const { master, occurrence: slot } = series({
    first: "2026-11-02T10:00:00-05:00",
    firstEnd: "2026-11-02T10:30:00-05:00",
    rule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
    slot: "2026-11-09T10:00:00-05:00",
    slotEnd: "2026-11-09T10:30:00-05:00",
  });
  const rescheduled: GoogleEvent = {
    ...slot,
    attendees: [{ email: "guest@example.com" }],
    end: at("2026-11-10T12:00:00-05:00"),
    location: "Offsite",
    start: at("2026-11-10T11:00:00-05:00"),
    summary: "Sync (offsite)",
  };
  const instant = (time: GoogleEvent["start"] | undefined) =>
    time?.dateTime ? new Date(time.dateTime).toISOString() : time?.date;

  test("sends only the repeat when only the repeat changed", () => {
    const sent = seriesEdit({
      // The form still holds the occurrence's values.
      edited: {
        ...rescheduled,
        end: at("2026-11-10T17:00:00.000Z"),
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
        start: at("2026-11-10T16:00:00.000Z"),
      },
      occurrence: rescheduled,
      series: master,
    });
    expect(sent).toEqual({
      end: expect.anything(),
      id: rescheduled.id,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      start: expect.anything(),
    });
    // Its place in the series, with the series' length.
    expect(instant(sent.start)).toBe(instant(at("2026-11-09T10:00:00-05:00")));
    expect(instant(sent.end)).toBe(instant(at("2026-11-09T10:30:00-05:00")));
  });

  test("a changed end keeps the series' start and takes the new length", () => {
    const sent = seriesEdit({
      edited: { ...rescheduled, end: at("2026-11-10T12:30:00-05:00") },
      occurrence: rescheduled,
      series: master,
    });
    expect(instant(sent.start)).toBe(instant(at("2026-11-09T10:00:00-05:00")));
    expect(instant(sent.end)).toBe(instant(at("2026-11-09T11:30:00-05:00")));
  });

  test("sends the fields the user changed, and a start they moved", () => {
    const sent = seriesEdit({
      edited: {
        ...rescheduled,
        end: at("2026-11-10T13:00:00-05:00"),
        location: "",
        start: at("2026-11-10T12:00:00-05:00"),
        summary: "Planning",
      },
      occurrence: rescheduled,
      series: master,
    });
    expect(sent.summary).toBe("Planning");
    // Cleared on purpose clears the series' too.
    expect(sent.location).toBe("");
    expect(sent.attendees).toBeUndefined();
    expect(instant(sent.start)).toBe(instant(at("2026-11-10T12:00:00-05:00")));
    expect(instant(sent.end)).toBe(instant(at("2026-11-10T13:00:00-05:00")));
  });

  test("a drag through the occurrence sends its new time, not its own title or place", () => {
    const sent = seriesEdit({
      edited: {
        ...rescheduled,
        end: at("2026-11-10T15:00:00-05:00"),
        start: at("2026-11-10T14:00:00-05:00"),
      },
      occurrence: rescheduled,
      series: master,
    });
    expect(Object.keys(sent).sort()).toEqual(["end", "id", "start"]);
  });
});
