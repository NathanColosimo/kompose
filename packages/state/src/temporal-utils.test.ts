import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { formatDuration, formatTimeRange } from "./temporal-utils";

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

  test("says the day period once within one half of the day", () => {
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

  test("adds dates once a range spans more than one night", () => {
    expect(range("2026-11-06T09:00", "2026-11-08T17:00")).toBe(
      "Nov 6 at 9 AM – Nov 8 at 5 PM"
    );
  });
});

describe("formatTimeRange edge cases", () => {
  test("adds dates when the range lasts a day or more", () => {
    expect(range("2026-11-06T09:00", "2026-11-07T17:00")).toBe(
      "Nov 6 at 9 AM – Nov 7 at 5 PM"
    );
    expect(range("2026-11-06T09:00", "2026-11-07T09:00")).toBe(
      "Nov 6 at 9 AM – Nov 7 at 9 AM"
    );
    expect(range("2026-11-07T00:00", "2026-11-08T00:00")).toBe(
      "Nov 7 at 12 AM – Nov 8 at 12 AM"
    );
  });

  test("keeps a leading day period on both ends", () => {
    // Korean puts 오전 (AM) before the time, so neither end can drop it.
    const text = formatTimeRange(
      at("2026-11-07T09:00"),
      at("2026-11-07T09:30"),
      "ko"
    );
    expect(text.match(/오전/g)?.length).toBe(2);
  });
});

describe("formatDuration", () => {
  test("uses hours and minutes", () => {
    expect([30, 60, 90].map(formatDuration)).toEqual(["30m", "1h", "1h 30m"]);
  });
});
