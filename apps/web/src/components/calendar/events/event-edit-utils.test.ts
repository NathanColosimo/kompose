/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  type EventSaveChanges,
  eventSaveDescription,
  eventSaveDisabledScopes,
} from "@kompose/state/recurrence-scope-options";
import { ORPCError } from "@orpc/client";
import {
  eventForScope,
  refuse,
  saveScopeDialog,
  seriesRefusal,
} from "./event-edit-utils";

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

// The series: Mondays 10:00-10:30 from Nov 2.
const master = {
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
  start: at("2026-11-02T10:00:00-05:00"),
};
// An occurrence on its own slot, as loaded.
const onSlot: GoogleEvent = {
  end: at("2026-11-16T10:30:00-05:00"),
  id: "sync_20261116T150000Z",
  originalStartTime: at("2026-11-16T10:00:00-05:00"),
  recurringEventId: "sync",
  start: at("2026-11-16T10:00:00-05:00"),
  summary: "Weekly sync",
};
const forScope = (
  edited: GoogleEvent,
  scope: "all" | "following" | "this",
  opened = occurrence
) =>
  eventForScope({ edited, master, occurrence: opened, scope, timeZone: zone });

describe("eventForScope", () => {
  test("one occurrence gets the whole edit, as loaded", () => {
    const edited = { ...occurrence, summary: "Planning" };
    expect(forScope(edited, "this")).toBe(edited);
  });

  test("the series gets the times as they are, and nothing left alone", () => {
    // The editor's payload starts from the whole occurrence. Its own times
    // go as they are: equal to the occurrence's, they mean unchanged, and
    // under This and following a moved one stays moved.
    for (const scope of ["all", "following"] as const) {
      expect(forScope({ ...occurrence }, scope)).toEqual({
        end: occurrence.end,
        id: occurrence.id,
        start: occurrence.start,
      });
    }
  });

  test("the series gets the fields the user changed, a cleared one empty", () => {
    const sent = forScope(
      { ...occurrence, colorId: undefined, location: "", summary: "Planning" },
      "all"
    );
    expect(sent.summary).toBe("Planning");
    expect(sent.location).toBe("");
    // Back to the calendar's color, for the series too.
    expect(sent.colorId).toBe("");
    expect(sent.attendees).toBeUndefined();
    expect(sent.extendedProperties).toBeUndefined();
  });

  test("a field empty where the occurrence had none isn't sent", () => {
    // The form writes "" for a field it shows empty.
    const sent = forScope(
      { ...onSlot, description: "", location: "" },
      "all",
      onSlot
    );
    // Undefined, which the request leaves out.
    expect(sent.description).toBeUndefined();
    expect(sent.location).toBeUndefined();
  });

  test("a repeat only when the user changed it or the day moved", () => {
    // Unchanged, on its own day: the series keeps its rule.
    expect("recurrence" in forScope({ ...onSlot }, "all", onSlot)).toBe(false);
    // A new time on its own day: still no rule.
    const later = {
      ...onSlot,
      end: at("2026-11-16T11:30:00-05:00"),
      start: at("2026-11-16T11:00:00-05:00"),
    };
    expect("recurrence" in forScope(later, "following", onSlot)).toBe(false);
    // The user's own repeat goes as it is.
    const own = ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"];
    expect(
      forScope({ ...onSlot, recurrence: own }, "following", onSlot).recurrence
    ).toBe(own);
    // Moved to Tuesday: the series' rule follows the new day.
    const tuesday = {
      ...onSlot,
      end: at("2026-11-17T10:30:00-05:00"),
      start: at("2026-11-17T10:00:00-05:00"),
    };
    expect(forScope(tuesday, "following", onSlot).recurrence?.[0]).toContain(
      "BYDAY=TU"
    );
  });
});

describe("seriesRefusal", () => {
  test("reads the server's refusal of a series write, with its words", () => {
    const refusal = seriesRefusal(
      new ORPCError("BAD_REQUEST", {
        data: { reason: "severalTimesADay" },
        message: "This series meets more than once a day…",
      })
    );
    expect(refusal).toEqual({
      message: "This series meets more than once a day…",
      reason: "severalTimesADay",
    });
  });

  test("is null for any other failure", () => {
    expect(seriesRefusal(new ORPCError("BAD_REQUEST"))).toBeNull();
    expect(seriesRefusal(new ORPCError("INTERNAL_SERVER_ERROR"))).toBeNull();
    expect(seriesRefusal(new Error("offline"))).toBeNull();
  });
});

describe("saveScopeDialog", () => {
  // A new time for one occurrence, its series loaded.
  const retimed: EventSaveChanges = {
    calendarChanged: false,
    dateMoved: false,
    patternChanged: false,
    retimed: true,
    seriesRuleLoaded: true,
  };

  test("is the shared rules and line when nothing was refused", () => {
    expect(saveScopeDialog(retimed, null)).toEqual({
      description: eventSaveDescription(retimed),
      disabled: eventSaveDisabledScopes(retimed),
    });
  });

  test("turns the refused scope off and leads with the server's reason", () => {
    const message =
      "This would undo changes made to single occurrences (Nov 24), so it wasn't saved.";
    const dialog = saveScopeDialog(retimed, refuse(null, "all", message));
    expect(eventSaveDisabledScopes(retimed).all).toBeFalsy();
    expect(dialog.disabled.all).toBe(true);
    expect(dialog.description.startsWith(message)).toBe(true);
  });

  test("keeps every scope refused in a row off, led by the latest reason", () => {
    const first = refuse(null, "all", "Entire series would undo Nov 24.");
    const second = refuse(first, "following", "This and following would too.");
    const dialog = saveScopeDialog(retimed, second);
    expect(dialog.disabled.all).toBe(true);
    expect(dialog.disabled.following).toBe(true);
    expect(dialog.description.startsWith("This and following would too.")).toBe(
      true
    );
  });
});
