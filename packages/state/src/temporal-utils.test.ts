import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  formatAllDayWhen,
  formatClockRange,
  formatClockTime,
  formatDuration,
  formatEventWhen,
  formatTimeRange,
  nearestSlotMinutes,
} from "./temporal-utils";

const zone = "America/New_York";
const at = (iso: string) =>
  Temporal.PlainDateTime.from(iso).toZonedDateTime(zone);

/**
 * Both ends carry their date. ICU versions word the join differently
 * ("Nov 6, 9 AM" or "Nov 6 at 9 AM"), so check the pieces, not the glue.
 */
function expectDated(text: string, start: string[], end: string[]) {
  const [first, second] = text.split(" – ");
  for (const piece of start) {
    expect(first).toContain(piece);
  }
  for (const piece of end) {
    expect(second).toContain(piece);
  }
}

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
    expectDated(
      range("2026-11-06T09:00", "2026-11-08T17:00"),
      ["Nov 6", "9 AM"],
      ["Nov 8", "5 PM"]
    );
  });
});

describe("formatTimeRange edge cases", () => {
  test("adds dates when the range lasts a day or more", () => {
    expectDated(
      range("2026-11-06T09:00", "2026-11-07T17:00"),
      ["Nov 6", "9 AM"],
      ["Nov 7", "5 PM"]
    );
    expectDated(
      range("2026-11-06T09:00", "2026-11-07T09:00"),
      ["Nov 6", "9 AM"],
      ["Nov 7", "9 AM"]
    );
    expectDated(
      range("2026-11-07T00:00", "2026-11-08T00:00"),
      ["Nov 7", "12 AM"],
      ["Nov 8", "12 AM"]
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

describe("nearestSlotMinutes", () => {
  test("a press on an hour line lands on that hour, even slightly above it", () => {
    expect(nearestSlotMinutes(11 * 60 + 30)).toBe(11 * 60 + 30);
    expect(nearestSlotMinutes(11 * 60 + 29.5)).toBe(11 * 60 + 30);
  });

  test("a press mid-slot takes the nearer line", () => {
    expect(nearestSlotMinutes(10 * 60 + 5)).toBe(10 * 60);
    expect(nearestSlotMinutes(10 * 60 + 10)).toBe(10 * 60 + 15);
  });

  test("stays inside the day", () => {
    expect(nearestSlotMinutes(-3)).toBe(0);
    expect(nearestSlotMinutes(24 * 60)).toBe(24 * 60 - 15);
  });
});

describe("formatClockTime", () => {
  test("drops a trailing AM/PM", () => {
    expect(formatClockTime(at("2026-11-09T10:25"), "en-US")).toBe("10:25");
    expect(
      formatClockRange(at("2026-11-09T11:30"), at("2026-11-09T12:30"), "en-US")
    ).toBe("11:30 – 12:30");
  });

  test("keeps a leading one", () => {
    expect(formatClockTime(at("2026-11-09T10:25"), "ko-KR")).toContain("오전");
  });
});

describe("formatEventWhen", () => {
  test("leads with the day, including for an overnight range", () => {
    expect(
      formatEventWhen(at("2026-11-12T09:00"), at("2026-11-12T10:00"), "en-US")
    ).toBe("Thu, Nov 12 · 9 – 10 AM");
    // An end at midnight is still the first day's.
    expect(
      formatEventWhen(at("2026-11-12T22:00"), at("2026-11-13T00:00"), "en-US")
    ).toBe("Thu, Nov 12 · 10 PM – 12 AM");
    expect(
      formatEventWhen(at("2026-11-12T00:00"), at("2026-11-13T00:00"), "en-US")
    ).toBe("Thu, Nov 12 · All day");
  });

  test("names both days for one that ends on a later day", () => {
    expect(
      formatEventWhen(at("2026-11-12T23:00"), at("2026-11-13T07:45"), "en-US")
    ).toBe("Thu, Nov 12, 11 PM – Fri, Nov 13, 7:45 AM");
    expect(
      formatEventWhen(at("2026-11-12T09:00"), at("2026-11-14T09:00"), "en-US")
    ).toBe("Thu, Nov 12, 9 AM – Sat, Nov 14, 9 AM");
  });
});

describe("formatAllDayWhen", () => {
  test("says all day for one day, and the span for more", () => {
    const nov12 = Temporal.PlainDate.from("2026-11-12");
    expect(formatAllDayWhen(nov12, nov12, "en-US")).toBe(
      "Thu, Nov 12 · All day"
    );
    expect(formatAllDayWhen(nov12, nov12.add({ days: 2 }), "en-US")).toBe(
      "Thu, Nov 12 – Sat, Nov 14"
    );
  });
});
