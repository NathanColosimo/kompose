/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { generateOccurrences } from "./recurrence";

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
