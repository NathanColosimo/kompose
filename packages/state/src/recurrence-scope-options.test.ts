import { describe, expect, test } from "bun:test";
import {
  chosenScope,
  type EventSaveChanges,
  eventSaveDisabledScopes,
} from "./recurrence-scope-options";

const unchanged: EventSaveChanges = {
  calendarMoved: false,
  dateMoved: false,
  patternChanged: false,
  seriesRuleLoaded: true,
};

describe("event save scopes", () => {
  test("offers all three scopes for an edit", () => {
    expect(eventSaveDisabledScopes(unchanged)).toEqual({});
  });
  test("a changed repeat cannot apply to one occurrence", () => {
    const disabled = eventSaveDisabledScopes({
      ...unchanged,
      patternChanged: true,
    });
    expect(chosenScope(null, "this", disabled)).toBe("following");
    expect(disabled).toEqual({ this: true });
  });
  test("a day move cannot apply to the entire series", () => {
    expect(eventSaveDisabledScopes({ ...unchanged, dateMoved: true })).toEqual({
      all: true,
    });
  });
  test("a calendar move applies to the entire series", () => {
    expect(
      eventSaveDisabledScopes({ ...unchanged, calendarMoved: true })
    ).toEqual({ following: true, this: true });
  });
  test("waits for the series before saving", () => {
    expect(
      eventSaveDisabledScopes({ ...unchanged, seriesRuleLoaded: false })
    ).toEqual({ all: true, following: true, this: true });
  });
  test("keeps the user's available choice", () => {
    expect(chosenScope("all", "this", {})).toBe("all");
    expect(chosenScope("all", "this", { all: true })).toBe("this");
  });
});
