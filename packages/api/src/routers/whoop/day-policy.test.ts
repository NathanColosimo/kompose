import { expect, test } from "bun:test";
import type { WhoopCachedDayRaw } from "@kompose/whoop/schema";
import { ttlForDay } from "./day-policy";

const timeZone = "America/New_York";

function settledDay(): WhoopCachedDayRaw {
  return {
    cycle: {
      created_at: "2026-11-04T04:00:00Z",
      end: "2026-11-06T04:00:00Z",
      id: 1,
      score_state: "SCORED",
      start: "2026-11-05T04:00:00Z",
      timezone_offset: "-05:00",
      updated_at: "2026-11-06T04:00:00Z",
      user_id: 1,
    },
    day: "2026-11-05",
    recovery: {
      created_at: "2026-11-05T12:00:00Z",
      cycle_id: 1,
      score_state: "SCORED",
      sleep_id: "00000000-0000-4000-8000-000000000001",
      updated_at: "2026-11-05T12:00:00Z",
      user_id: 1,
    },
    sleeps: [
      {
        created_at: "2026-11-05T12:00:00Z",
        cycle_id: 1,
        end: "2026-11-05T12:00:00Z",
        id: "00000000-0000-4000-8000-000000000001",
        nap: false,
        score_state: "SCORED",
        start: "2026-11-05T04:00:00Z",
        timezone_offset: "-05:00",
        updated_at: "2026-11-05T12:00:00Z",
        user_id: 1,
      },
    ],
    workouts: [
      {
        created_at: "2026-11-05T14:00:00Z",
        end: "2026-11-05T14:00:00Z",
        id: "00000000-0000-4000-8000-000000000002",
        score_state: "SCORED",
        sport_name: "Running",
        start: "2026-11-05T13:00:00Z",
        timezone_offset: "-05:00",
        updated_at: "2026-11-05T14:00:00Z",
        user_id: 1,
      },
    ],
  };
}

test("unfinished past WHOOP days refresh after 15 minutes instead of a week", () => {
  const day = settledDay();
  expect(ttlForDay(day, timeZone)).toBe(604_800);
  for (const record of [
    day.cycle,
    day.recovery,
    ...day.sleeps,
    ...day.workouts,
  ]) {
    if (record) {
      record.score_state = "PENDING_SCORE";
      expect(ttlForDay(day, timeZone)).toBe(900);
      record.score_state = "UNSCORABLE";
    }
  }
  expect(ttlForDay(day, timeZone)).toBe(604_800);
  if (day.cycle) {
    day.cycle.end = null;
  }
  expect(ttlForDay(day, timeZone)).toBe(900);
  const incomplete = settledDay();
  incomplete.recovery = null;
  expect(ttlForDay(incomplete, timeZone)).toBe(900);
  incomplete.cycle = null;
  incomplete.sleeps = [];
  incomplete.workouts = [];
  expect(ttlForDay(incomplete, timeZone)).toBe(900);
});
