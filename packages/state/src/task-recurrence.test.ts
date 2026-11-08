import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  getTaskUpdateScopeDecision,
  repeatBlocksSave,
  repeatNote,
} from "./task-recurrence";

const dailyUntil14 = {
  byDay: [],
  freq: "DAILY" as const,
  interval: 1,
  until: "2026-11-14",
};
const nov16 = Temporal.PlainDate.from("2026-11-16");

describe("repeatBlocksSave", () => {
  test("lets the last occurrence move past an unchanged series' end", () => {
    const params = {
      next: dailyUntil14,
      previous: dailyUntil14,
      startDate: nov16,
    };
    expect(repeatBlocksSave(params)).toBe(false);
    expect(repeatNote({ ...params, isRecurring: true })).toBeNull();
  });

  test("blocks a pattern the edit sets that ends before the start", () => {
    // A new task, or a one-off one made to repeat.
    expect(
      repeatBlocksSave({ next: dailyUntil14, previous: null, startDate: nov16 })
    ).toBe(true);
    expect(
      repeatNote({
        isRecurring: false,
        next: dailyUntil14,
        previous: null,
        startDate: nov16,
      })
    ).toEqual({
      blocking: true,
      text: "The repeat ends Nov\u00A014, before the task starts on Nov\u00A016.",
    });
  });

  test("needs a start date for a repeat the edit sets", () => {
    const weekly = {
      byDay: ["MO" as const],
      freq: "WEEKLY" as const,
      interval: 1,
    };
    expect(
      repeatNote({
        isRecurring: false,
        next: weekly,
        previous: null,
        startDate: null,
      })
    ).toEqual({
      blocking: true,
      text: "Pick a start date to repeat this task.",
    });
  });

  test("says what a repeat change does to an inbox occurrence", () => {
    const base = {
      isRecurring: true,
      previous: dailyUntil14,
      undatedMember: true,
    };
    expect(repeatNote({ ...base, next: null, startDate: null })?.text).toBe(
      "Takes this task out of its series."
    );
    expect(
      repeatNote({
        ...base,
        next: { ...dailyUntil14, until: undefined },
        startDate: nov16,
      })?.text
    ).toBe("Makes this task a series of its own.");
  });
});

describe("getTaskUpdateScopeDecision", () => {
  const base = {
    hasCoreFieldChanges: true,
    hasFollowing: true,
    isRecurring: true,
    nextRecurrence: null,
    nextTagIds: [],
    previousRecurrence: null,
    previousTagIds: [],
  };
  test("asks this-or-following for a dated occurrence", () => {
    expect(getTaskUpdateScopeDecision(base)).toEqual({
      action: "prompt",
      defaultScope: "this",
    });
  });

  test("applies a pattern change from this occurrence on, with no question", () => {
    const daily = { freq: "DAILY" as const, interval: 1 };
    // A new pattern, and "Repeat: None".
    expect(
      getTaskUpdateScopeDecision({
        ...base,
        hasCoreFieldChanges: false,
        nextRecurrence: { ...daily, count: 3 },
        previousRecurrence: daily,
      })
    ).toEqual({ action: "apply", scope: "following" });
    expect(
      getTaskUpdateScopeDecision({ ...base, previousRecurrence: daily })
    ).toEqual({ action: "apply", scope: "following" });
  });

  test("sees a count dropped from a pattern that also has an end date", () => {
    // Daily x4 until Nov 30 (both ends, as the API allows) made until-only.
    const until = { freq: "DAILY" as const, interval: 1, until: "2026-11-30" };
    expect(
      getTaskUpdateScopeDecision({
        ...base,
        hasCoreFieldChanges: false,
        nextRecurrence: until,
        previousRecurrence: { ...until, count: 4 },
      })
    ).toEqual({ action: "apply", scope: "following" });
  });

  test("applies an inbox occurrence's edits to it alone, with no question", () => {
    expect(
      getTaskUpdateScopeDecision({ ...base, hasFollowing: false })
    ).toEqual({ action: "apply", scope: "this" });
  });
});
