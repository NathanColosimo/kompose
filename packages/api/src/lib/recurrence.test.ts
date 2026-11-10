/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  generateOccurrences,
  repeatEndsBeforeStart,
  sameRecurrence,
} from "./recurrence";

const dates = (list: Temporal.PlainDate[]) => list.map(String);

describe("generateOccurrences", () => {
  test("starts on the start date when the pattern lands on it", () => {
    expect(
      dates(
        generateOccurrences(
          { byDay: ["MO"], count: 3, freq: "WEEKLY", interval: 1 },
          Temporal.PlainDate.from("2026-11-09")
        )
      )
    ).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);
  });

  test("keeps a start the pattern skips, counting it", () => {
    // Tuesday Nov 10, every 2 weeks on Monday, 3 times.
    expect(
      dates(
        generateOccurrences(
          { byDay: ["MO"], count: 3, freq: "WEEKLY", interval: 2 },
          Temporal.PlainDate.from("2026-11-10")
        )
      )
    ).toEqual(["2026-11-10", "2026-11-23", "2026-12-07"]);
  });

  test("leaves the start out when it's past the until date", () => {
    expect(
      generateOccurrences(
        { freq: "DAILY", interval: 1, until: "2026-11-01" },
        Temporal.PlainDate.from("2026-11-09")
      )
    ).toEqual([]);
  });
});

describe("repeatEndsBeforeStart", () => {
  const daily = { freq: "DAILY" as const, interval: 1 };

  test("is true only for an end date before the start", () => {
    expect(
      repeatEndsBeforeStart({ ...daily, until: "2026-11-05" }, "2026-11-09")
    ).toBe(true);
    expect(
      repeatEndsBeforeStart({ ...daily, until: "2026-11-09" }, "2026-11-09")
    ).toBe(false);
    expect(repeatEndsBeforeStart({ ...daily, count: 3 }, "2026-11-09")).toBe(
      false
    );
    expect(repeatEndsBeforeStart(null, "2026-11-09")).toBe(false);
  });
});

describe("sameRecurrence", () => {
  test("matches a pattern whatever its key and day order", () => {
    // Postgres jsonb hands keys back in its own order, unlike the request's.
    expect(
      sameRecurrence(
        { byDay: ["MO", "WE"], count: 4, freq: "WEEKLY", interval: 1 },
        JSON.parse(
          '{"freq":"WEEKLY","byDay":["WE","MO"],"count":4,"interval":1}'
        )
      )
    ).toBe(true);
  });

  test("treats a key set to undefined as missing", () => {
    const daily = { freq: "DAILY" as const, interval: 1 };
    expect(sameRecurrence({ ...daily, count: undefined }, daily)).toBe(true);
  });

  test("tells patterns apart", () => {
    const daily = { freq: "DAILY" as const, interval: 1 };
    expect(sameRecurrence(daily, { ...daily, count: 3 })).toBe(false);
    expect(sameRecurrence(daily, null)).toBe(false);
    expect(sameRecurrence(null, undefined)).toBe(true);
  });
});
