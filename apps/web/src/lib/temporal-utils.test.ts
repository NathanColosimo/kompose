// The web app only loads Node types; tests run under Bun.
/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { formatTimeRange } from "./temporal-utils";

const zone = "America/New_York";
const at = (iso: string) =>
  Temporal.PlainDateTime.from(iso).toZonedDateTime(zone);

/** ICU uses narrow and thin spaces; compare with plain ones. */
const range = (start: string, end: string) =>
  formatTimeRange(at(start), at(end)).replace(/\s/g, " ");

describe("formatTimeRange", () => {
  test("drops minutes when both ends are on the hour", () => {
    expect(range("2026-11-07T10:00", "2026-11-07T12:00")).toBe("10 AM – 12 PM");
  });

  test("shows the meridiem once within one half of the day", () => {
    expect(range("2026-11-07T09:00", "2026-11-07T09:30")).toBe(
      "9:00 – 9:30 AM"
    );
  });

  test("shows times only when the range ends at midnight", () => {
    expect(range("2026-11-07T23:00", "2026-11-08T00:00")).toBe("11 PM – 12 AM");
  });

  test("shows times only for an overnight range", () => {
    expect(range("2026-11-06T23:24", "2026-11-07T07:12")).toBe(
      "11:24 PM – 7:12 AM"
    );
  });
});
