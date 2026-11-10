import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import {
  formatAllDayWhen,
  formatClockRange,
  formatClockTime,
  formatDuration,
  formatEventWhen,
  formatScheduledAt,
  formatTimeRange,
  moveEventStart,
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

describe("formatScheduledAt", () => {
  const today = Temporal.PlainDate.from("2026-11-09");
  test("says today and tomorrow", () => {
    expect(formatScheduledAt(at("2026-11-09T10:00"), today, "en-US")).toBe(
      "Today 10:00 AM"
    );
    expect(formatScheduledAt(at("2026-11-10T09:30"), today, "en-US")).toBe(
      "Tomorrow 9:30 AM"
    );
  });

  test("works without Intl.RelativeTimeFormat, as on Hermes", () => {
    const { RelativeTimeFormat } = Intl;
    Reflect.deleteProperty(Intl, "RelativeTimeFormat");
    try {
      expect(formatScheduledAt(at("2026-11-09T10:00"), today, "en-US")).toBe(
        "Today 10:00 AM"
      );
      expect(formatScheduledAt(at("2026-11-10T09:30"), today, "en-US")).toBe(
        "Tomorrow 9:30 AM"
      );
    } finally {
      Object.assign(Intl, { RelativeTimeFormat });
    }
  });

  test("says the weekday within the coming week, else the date", () => {
    expect(formatScheduledAt(at("2026-11-14T10:00"), today, "en-US")).toBe(
      "Sat 10:00 AM"
    );
    expect(formatScheduledAt(at("2026-11-21T10:00"), today, "en-US")).toBe(
      "Nov 21, 10:00 AM"
    );
    expect(formatScheduledAt(at("2026-11-02T10:00"), today, "en-US")).toBe(
      "Nov 2, 10:00 AM"
    );
    expect(formatScheduledAt(at("2027-01-04T10:00"), today, "en-US")).toBe(
      "Jan 4, 2027, 10:00 AM"
    );
  });
});

describe("moveEventStart", () => {
  const d = (iso: string) => Temporal.PlainDate.from(iso);
  const t = (iso: string) => Temporal.PlainTime.from(iso);
  const text = (r: ReturnType<typeof moveEventStart>) =>
    `${r.startDate} ${r.startTime ?? "-"} → ${r.endDate} ${r.endTime ?? "-"}`;
  const meeting = {
    endDate: d("2026-11-12"),
    endTime: t("16:00"),
    startDate: d("2026-11-12"),
    startTime: t("14:00"),
  };

  test("keeps the length when the time moves", () => {
    expect(text(moveEventStart(meeting, { time: t("15:00") }))).toBe(
      "2026-11-12 15:00:00 → 2026-11-12 17:00:00"
    );
    expect(text(moveEventStart(meeting, { time: t("23:00") }))).toBe(
      "2026-11-12 23:00:00 → 2026-11-13 01:00:00"
    );
  });

  test("keeps the length when the date moves, either way", () => {
    expect(text(moveEventStart(meeting, { date: d("2026-11-10") }))).toBe(
      "2026-11-10 14:00:00 → 2026-11-10 16:00:00"
    );
    const overnight = {
      ...meeting,
      endDate: d("2026-11-13"),
      endTime: t("07:00"),
      startTime: t("23:00"),
    };
    expect(text(moveEventStart(overnight, { date: d("2026-11-14") }))).toBe(
      "2026-11-14 23:00:00 → 2026-11-15 07:00:00"
    );
  });

  test("a start the clocks skip comes out as the time it lands on", () => {
    // Mar 8 2026, New York: 2:00-3:00 doesn't happen. A 2:30-3:30 meeting
    // moved there starts at 3:30, and says so.
    const skipped = {
      endDate: d("2026-03-07"),
      endTime: t("03:30"),
      startDate: d("2026-03-07"),
      startTime: t("02:30"),
    };
    const moved = moveEventStart(skipped, { date: d("2026-03-08") }, zone);
    expect(text(moved)).toBe("2026-03-08 03:30:00 → 2026-03-08 04:30:00");
    expect(moved.start?.toPlainTime().toString()).toBe("03:30:00");
  });

  test("an all-day move leaves no moments behind", () => {
    const trip = {
      end: Temporal.ZonedDateTime.from(
        "2026-11-12T10:00:00-05:00[America/New_York]"
      ),
      endDate: d("2026-11-14"),
      endTime: null,
      start: Temporal.ZonedDateTime.from(
        "2026-11-12T09:00:00-05:00[America/New_York]"
      ),
      startDate: d("2026-11-12"),
      startTime: null,
    };
    const moved = moveEventStart(trip, { date: d("2026-11-20") }, zone);
    expect(moved.start).toBeUndefined();
    expect(moved.end).toBeUndefined();
  });

  test("keeps an all-day event's span", () => {
    const trip = {
      endDate: d("2026-11-14"),
      endTime: null,
      startDate: d("2026-11-12"),
      startTime: null,
    };
    expect(text(moveEventStart(trip, { date: d("2026-11-20") }))).toBe(
      "2026-11-20 - → 2026-11-22 -"
    );
  });

  test("gives 30 minutes when there's no length to keep", () => {
    const backwards = { ...meeting, endTime: t("13:00") };
    expect(text(moveEventStart(backwards, { time: t("09:00") }))).toBe(
      "2026-11-12 09:00:00 → 2026-11-12 09:30:00"
    );
  });

  test("keeps a zero-length event at zero", () => {
    const reminder = { ...meeting, endTime: t("14:00") };
    expect(text(moveEventStart(reminder, { time: t("09:00") }))).toBe(
      "2026-11-12 09:00:00 → 2026-11-12 09:00:00"
    );
  });

  test("in a zone, keeps the real length across a clock change", () => {
    // Nov 1 2026, New York: 1:00-2:00 happens twice. 0:30 to 2:30 on the
    // clock is three hours, which a move to Nov 2 keeps.
    const overTheChange = {
      endDate: d("2026-11-01"),
      endTime: t("02:30"),
      startDate: d("2026-11-01"),
      startTime: t("00:30"),
    };
    expect(
      text(moveEventStart(overTheChange, { date: d("2026-11-02") }, zone))
    ).toBe("2026-11-02 00:30:00 → 2026-11-02 03:30:00");
  });

  test("in a zone, keeps which of the repeated hour's two halves an end is in", () => {
    // Moved onto Nov 1 0:00, a two-hour meeting ends at 1:00 the second
    // time (EST). The clock can't tell that 1:00 from the first; the
    // range's moments can, through a second move too.
    const hours = (r: ReturnType<typeof moveEventStart>) =>
      r.start && r.end ? r.start.until(r.end).total("hours") : undefined;
    const twoHours = {
      endDate: d("2026-10-31"),
      endTime: t("02:00"),
      startDate: d("2026-10-31"),
      startTime: t("00:00"),
    };
    const moved = moveEventStart(twoHours, { date: d("2026-11-01") }, zone);
    expect(text(moved)).toBe("2026-11-01 00:00:00 → 2026-11-01 01:00:00");
    expect(moved.end?.offset).toBe("-05:00");
    expect(hours(moved)).toBe(2);
    const again = moveEventStart(moved, { time: t("00:30") }, zone);
    expect(text(again)).toBe("2026-11-01 00:30:00 → 2026-11-01 01:30:00");
    expect(hours(again)).toBe(2);
    // A one-hour meeting from 1:30 EDT to 1:30 EST stays one hour.
    const first = Temporal.ZonedDateTime.from(
      "2026-11-01T01:30:00-04:00[America/New_York]"
    );
    const repeated = {
      end: first.add({ hours: 1 }),
      endDate: d("2026-11-01"),
      endTime: t("01:30"),
      start: first,
      startDate: d("2026-11-01"),
      startTime: t("01:30"),
    };
    expect(
      hours(moveEventStart(repeated, { date: d("2026-11-02") }, zone))
    ).toBe(1);
    // Moved to its own day, a start in the repeated hour's second half
    // stays there.
    const second = Temporal.ZonedDateTime.from(
      "2026-11-01T01:30:00-05:00[America/New_York]"
    );
    const late = {
      end: second.add({ hours: 1 }),
      endDate: d("2026-11-01"),
      endTime: t("02:30"),
      start: second,
      startDate: d("2026-11-01"),
      startTime: t("01:30"),
    };
    const kept = moveEventStart(late, { date: d("2026-11-01") }, zone);
    expect(kept.start?.offset).toBe("-05:00");
    expect(text(kept)).toBe("2026-11-01 01:30:00 → 2026-11-01 02:30:00");
    // Ends edited since (the clock fields no longer match): the clock's.
    const edited = { ...moved, endTime: t("03:00") };
    expect(text(moveEventStart(edited, { time: t("00:00") }, zone))).toBe(
      "2026-11-01 00:00:00 → 2026-11-01 03:00:00"
    );
  });
});
