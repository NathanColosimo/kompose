import { describe, expect, test } from "bun:test";
import type { WhoopDaySummary } from "@kompose/api/routers/whoop/contract";
import { shouldShowWhoopRow } from "./whoop-data";

const day: WhoopDaySummary = {
  cycleId: 1,
  day: "2026-11-07",
  kilojoule: null,
  naps: [],
  recoveryScore: 72,
  sleep: null,
  sleepPerformance: null,
  strainScore: null,
  workouts: [],
};

describe("shouldShowWhoopRow", () => {
  test("keeps the row while WHOOP is linked, even without data", () => {
    expect(shouldShowWhoopRow("w-1", ["2026-11-08"], new Map())).toBe(true);
  });

  test("shows the row when a visible day has stats", () => {
    const summaries = new Map([[day.day, day]]);
    expect(shouldShowWhoopRow(null, ["2026-11-07"], summaries)).toBe(true);
  });

  test("hides the row with no account and no stats", () => {
    expect(shouldShowWhoopRow(null, ["2026-11-07"], new Map())).toBe(false);
  });
});
