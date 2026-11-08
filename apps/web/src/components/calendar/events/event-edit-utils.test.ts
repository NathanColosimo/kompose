/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { ORPCError } from "@orpc/client";
import { refusedDropDay, seriesSave } from "./event-edit-utils";

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

describe("refusedDropDay", () => {
  const refused = (data: unknown) =>
    new ORPCError("BAD_REQUEST", { data, message: "refused" });

  test("names the first moved meeting a refused series save would undo", () => {
    const error = refused({
      originalStarts: [
        "2026-12-07T10:00:00-05:00",
        "2026-12-14T10:00:00-05:00",
      ],
      reason: "dropsChangedOccurrences",
    });
    expect(refusedDropDay(error, zone)?.toString()).toBe("2026-12-07");
    // An all-day series' original starts are dates.
    const allDay = refused({
      originalStarts: ["2026-12-07"],
      reason: "dropsChangedOccurrences",
    });
    expect(refusedDropDay(allDay, zone)?.toString()).toBe("2026-12-07");
  });

  test("is null for any other failure", () => {
    expect(
      refusedDropDay(refused({ reason: "severalRules" }), zone)
    ).toBeNull();
    expect(refusedDropDay(new Error("offline"), zone)).toBeNull();
    expect(
      refusedDropDay(new ORPCError("INTERNAL_SERVER_ERROR"), zone)
    ).toBeNull();
  });
});
