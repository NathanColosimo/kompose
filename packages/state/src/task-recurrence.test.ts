import { describe, expect, test } from "bun:test";
import { getTaskUpdateScopeDecision } from "./task-recurrence";

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
  test("asks this-or-following for other edits", () => {
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
    // A pattern change still applies as "following": the server rejects it
    // for "this", and makes the occurrence a series of its own.
    expect(
      getTaskUpdateScopeDecision({
        ...base,
        hasFollowing: false,
        previousRecurrence: { freq: "DAILY", interval: 1 },
      })
    ).toEqual({ action: "apply", scope: "following" });
  });
});
