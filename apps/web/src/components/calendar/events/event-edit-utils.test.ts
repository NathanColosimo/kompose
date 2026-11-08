/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { repeatForSeries, seriesEventForSave } from "./event-edit-utils";

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
    expect(shown[0]).toContain("BYDAY=TH");
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
    expect(shown[0]).toContain("BYMONTHDAY=29");
  });

  test("keeps the series' rule when the day doesn't move", () => {
    const shown = repeatForSeries({
      edited: false,
      editedStart: at("2026-11-11T11:00:00-05:00"),
      master: weekly.master,
      occurrence: weekly.occurrence,
      recurrence: weekly.master.recurrence ?? [],
      timeZone: zone,
    });
    expect(shown).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=WE"]);
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
    expect(shown).toBe(own);
  });
});

describe("seriesEventForSave", () => {
  // Mondays 10:00-10:30; this one was rescheduled to Tue 11:00-12:00 and
  // renamed on its own.
  const { master, occurrence: slot } = series({
    first: "2026-11-02T10:00:00-05:00",
    firstEnd: "2026-11-02T10:30:00-05:00",
    rule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
    slot: "2026-11-09T10:00:00-05:00",
    slotEnd: "2026-11-09T10:30:00-05:00",
  });
  const rescheduled: GoogleEvent = {
    ...slot,
    end: at("2026-11-10T12:00:00-05:00"),
    start: at("2026-11-10T11:00:00-05:00"),
    summary: "Sync (moved for the offsite)",
  };
  const instant = (time: GoogleEvent["start"]) =>
    time.dateTime ? new Date(time.dateTime).toISOString() : time.date;

  test("leaves the occurrence's own time and title out of the series", () => {
    const sent = seriesEventForSave({
      master,
      occurrence: rescheduled,
      // Only the repeat changed: the form still holds the occurrence's values.
      sent: {
        ...rescheduled,
        end: at("2026-11-10T17:00:00.000Z"),
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
        start: at("2026-11-10T16:00:00.000Z"),
      },
    });
    expect(sent.summary).toBe("Weekly sync");
    expect(instant(sent.start)).toBe(instant(at("2026-11-09T10:00:00-05:00")));
    expect(instant(sent.end)).toBe(instant(at("2026-11-09T10:30:00-05:00")));
    expect(sent.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"]);
  });

  test("keeps the fields the user changed", () => {
    const sent = seriesEventForSave({
      master,
      occurrence: rescheduled,
      sent: {
        ...rescheduled,
        end: at("2026-11-10T13:00:00-05:00"),
        location: "Room 2",
        start: at("2026-11-10T12:00:00-05:00"),
        summary: "Planning",
      },
    });
    expect(sent.summary).toBe("Planning");
    expect(sent.location).toBe("Room 2");
    expect(instant(sent.start)).toBe(instant(at("2026-11-10T12:00:00-05:00")));
    expect(instant(sent.end)).toBe(instant(at("2026-11-10T13:00:00-05:00")));
  });

  test("an occurrence on its series' own slot sends its edits as they are", () => {
    const edited: GoogleEvent = { ...slot, description: "Agenda in the doc" };
    expect(
      seriesEventForSave({ master, occurrence: slot, sent: edited })
    ).toEqual(edited);
  });
});
