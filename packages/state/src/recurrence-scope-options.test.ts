import { expect, test } from "bun:test";
import {
  allowedEventSaveScope,
  type EventSaveChanges,
  eventSaveDescription,
  eventSaveDisabledScopes,
  RECURRENCE_SCOPE_OPTIONS,
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
    eventSaveDescription({ ...none, calendarChanged: true, dateMoved: true })
  ).toBe("Moving to another calendar moves the whole series.");
});
