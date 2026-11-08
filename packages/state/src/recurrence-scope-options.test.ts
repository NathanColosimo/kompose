import { expect, test } from "bun:test";
import {
  allowedEventSaveScope,
  type EventSaveChanges,
  eventSaveDescription,
  eventSaveDisabledScopes,
  RECURRENCE_SCOPE_OPTIONS,
  seriesSplitBlock,
} from "./recurrence-scope-options";

const none: EventSaveChanges = {
  calendarChanged: false,
  dateMoved: false,
  patternChanged: false,
  seriesRuleLoaded: true,
};

const off = (changes: Partial<EventSaveChanges>) =>
  Object.keys(eventSaveDisabledScopes({ ...none, ...changes })).sort();

test("disables the scopes a save can't use", () => {
  expect(off({})).toEqual([]);
  expect(off({ calendarChanged: true })).toEqual(["following", "this"]);
  expect(off({ patternChanged: true })).toEqual(["this"]);
  expect(off({ dateMoved: true })).toEqual(["all"]);
  // "This and following" carries the rule to the new day: it waits for it.
  expect(off({ dateMoved: true, seriesRuleLoaded: false })).toEqual([
    "all",
    "following",
  ]);
});

test("always leaves a scope to save with", () => {
  for (const calendarChanged of [false, true]) {
    for (const dateMoved of [false, true]) {
      for (const patternChanged of [false, true]) {
        for (const seriesRuleLoaded of [false, true]) {
          const disabled = eventSaveDisabledScopes({
            calendarChanged,
            dateMoved,
            patternChanged,
            seriesRuleLoaded,
          });
          const scope = allowedEventSaveScope("this", disabled);
          expect(disabled[scope]).toBeFalsy();
          expect(
            RECURRENCE_SCOPE_OPTIONS.some((option) => !disabled[option.value])
          ).toBe(true);
        }
      }
    }
  }
});

test("says why the scopes are what they are", () => {
  expect(eventSaveDescription({ ...none, dateMoved: true })).toBe(
    "A new day applies to this occurrence, or from it on."
  );
  expect(
    eventSaveDescription({ ...none, dateMoved: true, seriesRuleLoaded: false })
  ).toBe("Loading the series… This and following opens once it's in.");
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesRuleFailed: true,
      seriesRuleLoaded: false,
    })
  ).toBe(
    "Couldn't load the series, so the new day applies to this occurrence only. Try again later for the rest."
  );
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesTimeZone: "Asia/Tokyo",
    })
  ).toBe("A new day in Tokyo time applies to this occurrence, or from it on.");
  expect(
    eventSaveDescription({
      ...none,
      dateMoved: true,
      seriesTimeZone: "Etc/GMT-9",
    })
  ).toBe("A new day applies to this occurrence, or from it on.");
  expect(
    eventSaveDescription({ ...none, calendarChanged: true, dateMoved: true })
  ).toBe("Moving to another calendar moves the whole series.");
});

test("turns This and following off where a new series can't start", () => {
  const zone = "America/New_York";
  const master = {
    recurrence: [
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=4",
      "RDATE;TZID=America/New_York:20261116T090000",
    ],
    start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
  };
  const occurrence = (dateTime: string) => ({
    originalStartTime: { dateTime, timeZone: zone },
    recurringEventId: "series",
    start: { dateTime, timeZone: zone },
  });
  // The off-week Monday was added on its own: a new series from it would
  // move every later meeting a week.
  expect(
    seriesSplitBlock(occurrence("2026-11-16T09:00:00-05:00"), master, zone)
  ).toBe("addedOccurrence");
  // The rule's own Nov 23 can start one.
  expect(
    seriesSplitBlock(occurrence("2026-11-23T09:00:00-05:00"), master, zone)
  ).toBeNull();
  // Several rules (every 2 days, and Tuesdays): never.
  expect(
    seriesSplitBlock(
      occurrence("2026-11-10T09:00:00-05:00"),
      {
        ...master,
        recurrence: [
          "RRULE:FREQ=DAILY;INTERVAL=2",
          "RRULE:FREQ=WEEKLY;BYDAY=TU",
        ],
      },
      zone
    )
  ).toBe("severalRules");
  // The scope dialog then offers the rest, and says why.
  const blocked = { ...none, splitBlocked: "addedOccurrence" as const };
  expect(off(blocked)).toEqual(["following"]);
  expect(eventSaveDescription(blocked)).toBe(
    "This occurrence was added to the series on its own, so This and following isn't available."
  );
  expect(off({ ...blocked, dateMoved: true })).toEqual(["all", "following"]);
});
