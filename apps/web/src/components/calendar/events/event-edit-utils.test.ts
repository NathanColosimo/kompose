/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { seriesSave } from "./event-edit-utils";

const zone = "America/New_York";
const at = (dateTime: string) => ({ dateTime, timeZone: zone });

// Mondays 10:00-10:30; this one was rescheduled to Tue 11:00-12:00, and
// renamed and given its own guest on its own.
const occurrence: GoogleEvent = {
  attendees: [{ email: "guest@example.com" }],
  colorId: "5",
  end: at("2026-11-10T12:00:00-05:00"),
  id: "sync_20261109T150000Z",
  location: "Offsite",
  originalStartTime: at("2026-11-09T10:00:00-05:00"),
  recurringEventId: "sync",
  extendedProperties: { private: { agenda: "offsite" } },
  start: at("2026-11-10T11:00:00-05:00"),
  summary: "Sync (offsite)",
};

describe("seriesSave", () => {
  test("sends the id, the times as they are and the repeat, and nothing left alone", () => {
    // The editor's payload starts from the whole occurrence.
    const sent = seriesSave(
      { ...occurrence, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"] },
      occurrence
    );
    expect(sent).toEqual({
      end: occurrence.end,
      id: occurrence.id,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      start: occurrence.start,
    });
  });

  test("sends the fields the user changed, and a cleared one empty", () => {
    const sent = seriesSave(
      { ...occurrence, colorId: undefined, location: "", summary: "Planning" },
      occurrence
    );
    expect(sent.summary).toBe("Planning");
    expect(sent.location).toBe("");
    // Back to the calendar's color, for the series too.
    expect(sent.colorId).toBe("");
    expect(sent.attendees).toBeUndefined();
    expect(sent.extendedProperties).toBeUndefined();
    expect("recurrence" in sent).toBe(false);
  });
});
