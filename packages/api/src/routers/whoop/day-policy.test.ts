import { describe, expect, test } from "bun:test";
import type { WhoopCachedDayRaw } from "@kompose/whoop/schema";
import { Temporal } from "temporal-polyfill";
import { missingDayFetchRanges, ttlForDay } from "./day-policy";

const now = Temporal.Instant.from("2026-11-06T17:00:00Z");
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

describe("WHOOP day freshness", () => {
  test("closed past bundles accept both scored and unscorable records for seven days", () => {
    const day = settledDay();
    expect(ttlForDay(day, timeZone, now)).toBe(604_800);
    for (const record of [
      day.cycle,
      day.recovery,
      ...day.sleeps,
      ...day.workouts,
    ]) {
      if (record) {
        record.score_state = "UNSCORABLE";
      }
    }
    expect(ttlForDay(day, timeZone, now)).toBe(604_800);
  });

  test("empty days and orphan workouts refresh in 15 minutes", () => {
    const day = settledDay();
    day.cycle = null;
    day.recovery = null;
    day.sleeps = [];
    expect(ttlForDay(day, timeZone, now)).toBe(900);
    day.workouts = [];
    expect(ttlForDay(day, timeZone, now)).toBe(900);
  });

  test("today follows the requested timezone even for a closed bundle", () => {
    const day = settledDay();
    const nearMidnight = Temporal.Instant.from("2026-11-06T04:30:00Z");
    expect(ttlForDay(day, timeZone, nearMidnight)).toBe(900);
    expect(ttlForDay(day, "UTC", nearMidnight)).toBe(604_800);
  });

  test("an end timestamp in the future does not close a cycle yet", () => {
    const day = settledDay();
    if (day.cycle) {
      day.cycle.end = "2026-11-07T04:00:00Z";
    }
    expect(ttlForDay(day, timeZone, now)).toBe(900);
  });

  test("a closed cycle with missing recovery or its sleep is still incomplete", () => {
    const missingRecovery = settledDay();
    missingRecovery.recovery = null;
    expect(ttlForDay(missingRecovery, timeZone, now)).toBe(900);

    const missingSleep = settledDay();
    missingSleep.sleeps = [];
    expect(ttlForDay(missingSleep, timeZone, now)).toBe(900);
  });

  test("a past day with an open cycle must refresh in 15 minutes", () => {
    const day = settledDay();
    if (day.cycle) {
      day.cycle.end = null;
    }
    expect(ttlForDay(day, timeZone, now)).toBe(900);
  });

  test("a past day with a pending record must refresh in 15 minutes", () => {
    const day = settledDay();
    for (const record of [
      day.cycle,
      day.recovery,
      ...day.sleeps,
      ...day.workouts,
    ]) {
      if (record) {
        record.score_state = "PENDING_SCORE";
        expect(ttlForDay(day, timeZone, now)).toBe(900);
        record.score_state = "SCORED";
      }
    }
  });
});

describe("WHOOP missing fetch ranges", () => {
  test("empty requests and fully cached requests need no fetch", () => {
    const params = {
      cachedDays: new Map([["2026-11-05", settledDay()]]),
      days: ["2026-11-05"],
      timeZone,
    };
    expect(missingDayFetchRanges(params)).toEqual([]);
    expect(missingDayFetchRanges({ ...params, days: [] })).toEqual([]);
  });

  test("splits missing days around cached days", () => {
    expect(
      missingDayFetchRanges({
        cachedDays: new Map([["2026-11-03", settledDay()]]),
        days: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"],
        timeZone,
      })
    ).toEqual([
      {
        days: ["2026-11-01", "2026-11-02"],
        end: "2026-11-03T05:00:00Z",
        start: "2026-10-31T22:00:00Z",
      },
      {
        days: ["2026-11-04"],
        end: "2026-11-05T05:00:00Z",
        start: "2026-11-03T23:00:00Z",
      },
    ]);
  });
});
