/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { eventSaveDisabledScopes } from "@kompose/state/recurrence-scope-options";
import { eventForScope, saveFacts } from "./event-edit-utils";

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

describe("saveFacts", () => {
  // The series, loaded: Mondays 10:00-10:30 from Nov 2, in New York.
  const series: GoogleEvent = {
    end: at("2026-11-02T10:30:00-05:00"),
    id: "sync",
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
    start: at("2026-11-02T10:00:00-05:00"),
    summary: "Weekly sync",
  };
  const later = {
    end: at("2026-11-16T11:30:00-05:00"),
    start: at("2026-11-16T11:00:00-05:00"),
  };
  const facts = (
    edited: Pick<GoogleEvent, "end" | "recurrence" | "start">,
    // null: the series hasn't loaded.
    loadedSeries: GoogleEvent | null = series
  ) =>
    saveFacts({
      edited,
      event: onSlot,
      master: loadedSeries ?? undefined,
      timeZone: zone,
    });

  test("a new time on its own day leaves every scope on", () => {
    // What it would cost other occurrences is the server's to refuse.
    const changes = facts(later);
    expect(changes.retimed).toBe(true);
    expect(changes.dateMoved).toBe(false);
    expect(
      eventSaveDisabledScopes({
        ...changes,
        calendarChanged: false,
        patternChanged: false,
        seriesRuleLoaded: true,
      })
    ).toEqual({});
  });

  test("times left as they were move nothing", () => {
    const changes = facts({ end: onSlot.end, start: onSlot.start });
    expect(changes.retimed).toBe(false);
    expect(changes.dateMoved).toBe(false);
  });

  test("a series that meets twice a day can't take a new time as a whole", () => {
    const twice = {
      ...series,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=15;BYMINUTE=0",
      ],
    };
    const changes = facts(later, twice);
    expect(changes.severalRules).toBe(true);
    expect(changes.movesSeveralADay).toBe(true);
  });

  test("a series in another zone is named, from its own start", () => {
    const tokyo = {
      ...series,
      start: { ...series.start, timeZone: "Asia/Tokyo" },
    };
    expect(facts(later, tokyo).seriesTimeZone).toBe("Asia/Tokyo");
    expect(facts(later).seriesTimeZone).toBeUndefined();
  });

  test("before the series loads, a new time might move its start", () => {
    const changes = facts(later, null);
    expect(changes.retimed).toBe(true);
  });
});
