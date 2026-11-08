/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { endedBefore, heirPattern } from "./occurrence-rows";

describe("heirPattern", () => {
  test("counts the occurrences left for the next master", () => {
    const daily4 = { count: 4, freq: "DAILY" as const, interval: 1 };
    // Nov 9 (master) deleted, Nov 10 deleted earlier: Nov 11 and 12 left.
    expect(heirPattern(daily4, 2)).toEqual({ ...daily4, count: 2 });
    const open = { freq: "DAILY" as const, interval: 1 };
    expect(heirPattern(open, 2)).toEqual(open);
  });
});

describe("endedBefore", () => {
  test("never ends past the last occurrence or the pattern's own end", () => {
    const daily = { freq: "DAILY" as const, interval: 1 };
    // Master moved to Nov 20; Nov 10-12 are what's left.
    expect(endedBefore(daily, "2026-11-20", "2026-11-12")).toEqual({
      ...daily,
      until: "2026-11-12",
    });
    expect(
      endedBefore({ ...daily, until: "2026-11-11" }, "2026-11-20", "2026-11-12")
    ).toEqual({ ...daily, until: "2026-11-11" });
  });

  test("stops a pattern the day before, dropping its count", () => {
    expect(
      endedBefore({ count: 4, freq: "DAILY", interval: 1 }, "2026-11-13")
    ).toEqual({ freq: "DAILY", interval: 1, until: "2026-11-12" });
  });
});
