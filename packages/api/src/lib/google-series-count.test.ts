import { describe, expect, test } from "bun:test";
import {
  countLeft,
  truncateRecurrenceForFollowing,
  withCount,
} from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import { Exit } from "effect";
import { Temporal } from "temporal-polyfill";
import {
  edit,
  fakeGoogle,
  occurrenceOf,
  refusalOf,
  run,
  service,
  weekly,
  zone,
} from "./google-test-fixtures";

// A COUNT carried on through a split: exactly the meetings left.

/**
 * A split's new `recurrence` with the series' COUNT carried on: the
 * positions left from the split, read from Google's list (`starts`) when a
 * clock change before it skips the series' time. Null where they can't be
 * told.
 */
const carried = (
  recurrence: string[],
  params: {
    masterRecurrence: string[];
    originalStart: string;
    seriesStart: string;
    seriesZone: string;
    /** Google's list of the series' meetings, by original start. */
    starts?: string[];
  }
) => {
  const left = countLeft({
    listed: params.starts,
    originalStart: params.originalStart,
    recurrence: params.masterRecurrence,
    seriesStart: params.seriesStart.includes("T")
      ? { dateTime: params.seriesStart }
      : { date: params.seriesStart },
    seriesZone: params.seriesZone,
  });
  return left === null ? null : withCount(recurrence, left);
};

describe("a kept COUNT sent with its days in another order", () => {
  test("carries the meetings left", async () => {
    // Mondays and Wednesdays six times from Nov 9 (Nov 9, 11, 16, 18, 23,
    // 25); renamed from Nov 16 with the same rule written MO,WE: four left.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE,MO;COUNT=6"],
    };
    const google = fakeGoogle(series, []);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6"],
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
    ]);
  });
});

describe("a deleted meeting both added and the rule's", () => {
  test("doesn't cost a later meeting its place", async () => {
    // Mondays 9:00, six times from Nov 9; Nov 30 also added, and deleted
    // on its own. From Nov 16 moved to 10:00: Nov 16, 23, 30, Dec 7 and 14
    // are left, so COUNT is 5 (Dec 14 isn't dropped).
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6",
        "RDATE:20261130T140000Z",
      ],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5"
    );
  });
});

describe("a COUNT split more than fifty years in", () => {
  test("carries the meetings left", async () => {
    // Yearly a hundred times from 1950: split in 2026, 24 are left.
    const series: Event = {
      end: { dateTime: "1950-11-09T09:30:00Z", timeZone: "UTC" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=100"],
      start: { dateTime: "1950-11-09T09:00:00Z", timeZone: "UTC" },
      summary: "Anniversary",
    };
    const google = fakeGoogle(series, []);
    const opened = occurrenceOf(series, "2026-11-09T09:00:00Z");
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Anniversary (new)" }))
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=24",
    ]);
  });
});

describe("a yearly COUNT split more than fifty years in", () => {
  // Yearly on Nov 9 at 9:00 UTC from 1978, 148 times (to 2125).
  const yearly = (recurrence: string[], startTime = "1978-11-09T09:00:00Z") => {
    const series: Event = {
      end: { dateTime: "1978-11-09T09:30:00Z", timeZone: "UTC" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=148", ...recurrence],
      start: { dateTime: startTime, timeZone: "UTC" },
      summary: "Anniversary",
    };
    // Google gives its occurrences' starts with their offsets.
    const listed: Event = {
      ...series,
      start: { dateTime: "1978-11-09T09:00:00Z", timeZone: "UTC" },
    };
    const google = fakeGoogle(series, []);
    const rename = (year: number) =>
      edit("following", occurrenceOf(listed, `${year}-11-09T09:00:00Z`), {
        summary: "Anniversary (new)",
      });
    return { google, rename };
  };

  test("doesn't count a skip from before the series began", async () => {
    // Left by an earlier split: still carrying the old series' Nov 9,
    // 1977 skip. Split at 2029, 51 are used (1978 to 2028), so 97 are left.
    const { google, rename } = yearly(["EXDATE:19771109T090000Z"]);
    expect(Exit.isSuccess(await run(rename(2029)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=97",
      "EXDATE:19771109T090000Z",
    ]);
  });

  test("counts before the split without a skip from before the series began", async () => {
    // The same 1977 skip, and a 10:00 Nov 9, 2031 skip after the split,
    // where nothing meets: 1978 to 2028 are used, and both skips stay.
    const { google, rename } = yearly([
      "EXDATE:19771109T090000Z",
      "EXDATE:20311109T100000Z",
    ]);
    expect(Exit.isSuccess(await run(rename(2029)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=97",
      "EXDATE:19771109T090000Z",
      "EXDATE:20311109T100000Z",
    ]);
  });

  test("counts a skipped meeting as a position", async () => {
    // Nov 9, 2029 skipped: split at 2030, 52 are used, so 96 are left.
    const { google, rename } = yearly(["EXDATE:20291109T090000Z"]);
    expect(Exit.isSuccess(await run(rename(2030)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=96",
      "EXDATE:20291109T090000Z",
    ]);
  });

  test("doesn't count a skip before the split where nothing met", async () => {
    // Nov 9, 2029 at 10:00 isn't a meeting: 52 are used, so 96 are left.
    const { google, rename } = yearly(["EXDATE:20291109T100000Z"]);
    expect(Exit.isSuccess(await run(rename(2030)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=96",
      "EXDATE:20291109T100000Z",
    ]);
  });

  test("counts past skips on days the rule doesn't meet", async () => {
    // Dec 1 isn't one of the rule's days, so neither skip is a position:
    // split at 2030, 52 are used, so 96 are left.
    const { google, rename } = yearly([
      "EXDATE:20291201T090000Z",
      "EXDATE:20311201T090000Z",
    ]);
    expect(Exit.isSuccess(await run(rename(2030)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=96",
      "EXDATE:20291201T090000Z",
      "EXDATE:20311201T090000Z",
    ]);
  });

  test("counts past skips at another time than the rule's", async () => {
    // Skips on the rule's own days at 10:00, where a rule meeting at 9:00
    // never is: neither is a position, so 96 are left.
    const { google, rename } = yearly([
      "EXDATE:20291109T100000Z",
      "EXDATE:20311109T100000Z",
    ]);
    expect(Exit.isSuccess(await run(rename(2030)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=96",
      "EXDATE:20291109T100000Z",
      "EXDATE:20311109T100000Z",
    ]);
  });

  test("counts around added days off the rule's days on both sides of the split", async () => {
    // Dec 1 in 2029 and 2031 is no Nov 9: no position. 52 meetings before
    // the 2030 split, so 96 are left.
    const { google, rename } = yearly([
      "RDATE:20291201T090000Z",
      "RDATE:20311201T090000Z",
    ]);
    expect(Exit.isSuccess(await run(rename(2030)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toContain(
      "RRULE:FREQ=YEARLY;COUNT=96"
    );
  });

  test("walks to the split when skips off the rule's days fall on both sides", async () => {
    // Yearly from 2028, 98 times, Dec 1 skipped in 2029 and 2031: no
    // meeting is skipped, and the walk to the 2030 split finds two used.
    const series: Event = {
      end: { dateTime: "2028-11-09T09:30:00Z", timeZone: "UTC" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: [
        "RRULE:FREQ=YEARLY;COUNT=98",
        "EXDATE:20291201T090000Z",
        "EXDATE:20311201T090000Z",
      ],
      start: { dateTime: "2028-11-09T09:00:00Z", timeZone: "UTC" },
      summary: "Anniversary",
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2030-11-09T09:00:00Z"), {
            summary: "Anniversary (new)",
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=96",
      "EXDATE:20291201T090000Z",
      "EXDATE:20311201T090000Z",
    ]);
  });

  test("reads a series start Google wrote without an offset", async () => {
    const { google, rename } = yearly([], "1978-11-09T09:00:00");
    expect(Exit.isSuccess(await run(rename(2029)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=97",
    ]);
  });
});

describe("carrying a COUNT through a split", () => {
  test("carries on a kept COUNT from where the series is cut", () => {
    // A five-time series split at its third: three left, also when the
    // rule is written COUNT-first.
    for (const [rule, left] of [
      ["RRULE:FREQ=DAILY;COUNT=5", "RRULE:FREQ=DAILY;COUNT=3"],
      ["RRULE:COUNT=5;FREQ=DAILY", "RRULE:COUNT=3;FREQ=DAILY"],
    ]) {
      expect(
        carried([rule ?? ""], {
          masterRecurrence: [rule ?? ""],
          originalStart: "2026-11-03",
          seriesStart: "2026-11-01",
          seriesZone: "America/New_York",
        })
      ).toEqual([left ?? ""]);
    }
  });

  test("carries a COUNT on by rule positions, skipped ones in", () => {
    // Daily COUNT=5 from Nov 1, Nov 2 skipped, split at Nov 3: two
    // positions are used before the split, three left.
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "EXDATE;VALUE=DATE:20261102",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("carries a COUNT on exactly with added days", () => {
    // Daily COUNT=5 from Nov 1 plus an RDATE on Nov 2 (a rule day too) and
    // Nov 20: walked, the rule's days are Nov 1–5, three from Nov 3.
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "RDATE;VALUE=DATE:20261102,20261120",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  // Google's own date-times: New York's offset is negative.
  const nyDaily = (day: number, hour = 9) =>
    `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00-05:00`;

  test("counts timed occurrences written with a negative offset", () => {
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
        originalStart: nyDaily(3),
        seriesStart: nyDaily(1),
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("counts starts written with fractional seconds", () => {
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
        originalStart: "2026-11-03T14:00:00.000Z",
        seriesStart: "2026-11-01T14:00:00.000Z",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("cuts a rule with a list of times where Google ends it", () => {
    // Mondays with BYHOUR=9,15 four times from Nov 30: Google meets once a
    // day, at the start's 9:00 (Nov 30 to Dec 21). Split at Dec 14, the
    // old part ends the second before and the new one has two left.
    const rule = "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15;COUNT=4";
    expect(
      truncateRecurrenceForFollowing({
        originalStart: "2026-12-14T09:00:00-05:00",
        recurrence: [rule],
        seriesStart: { dateTime: "2026-11-30T09:00:00-05:00" },
        seriesZone: "America/New_York",
      })
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15;UNTIL=20261214T135959Z",
    ]);
    expect(
      carried([rule], {
        masterRecurrence: [rule],
        originalStart: "2026-12-14T09:00:00-05:00",
        seriesStart: "2026-11-30T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15;COUNT=2"]);
  });

  test("can't tell a count only when a day before the split has no meeting time", () => {
    // Daily at 2:30 three times from Mar 12 2027; New York has no 2:30 on
    // Mar 14. Split at Mar 13, before that day, one is used whatever
    // Google does on Mar 14. Split at Mar 15, whether Mar 14 counted can't
    // be told.
    const rule = "RRULE:FREQ=DAILY;COUNT=3";
    const carry = (originalStart: string) =>
      carried([rule], {
        masterRecurrence: [rule],
        originalStart,
        seriesStart: "2027-03-12T02:30:00-05:00",
        seriesZone: "America/New_York",
      });
    expect(carry("2027-03-13T02:30:00-05:00")).toEqual([
      "RRULE:FREQ=DAILY;COUNT=2",
    ]);
    expect(carry("2027-03-15T02:30:00-04:00")).toBeNull();
  });

  test("walks a COUNT more than fifty years to the split", () => {
    // A yearly rule from 1950 a hundred times, split in 2026: 24 left.
    const yearly = ["RRULE:FREQ=YEARLY;COUNT=100"];
    expect(
      carried(yearly, {
        masterRecurrence: yearly,
        originalStart: "2026-11-09T09:00:00Z",
        seriesStart: "1950-11-09T09:00:00Z",
        seriesZone: "UTC",
      })
    ).toEqual(["RRULE:FREQ=YEARLY;COUNT=24"]);
  });

  test("doesn't count added days on either side of the split", () => {
    // Monday of week 46 three times from 2026, with Nov 17 added (and Nov
    // 20, 2028): one position before the 2027 split, so two are left.
    const rule = "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=3";
    const params = {
      originalStart: "2027-11-15",
      seriesStart: "2026-11-09",
      seriesZone: "America/New_York",
    };
    expect(
      carried([rule], {
        ...params,
        masterRecurrence: [rule, "RDATE;VALUE=DATE:20261117"],
      })
    ).toEqual(["RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2"]);
    expect(
      carried([rule], {
        ...params,
        masterRecurrence: [rule, "RDATE;VALUE=DATE:20261117,20281120"],
      })
    ).toEqual(["RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2"]);
  });

  test("carries a week-number COUNT with its added day after the split", () => {
    const rule = "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=3";
    expect(
      carried([rule], {
        masterRecurrence: [rule, "RDATE;VALUE=DATE:20271120"],
        originalStart: "2027-11-15",
        seriesStart: "2026-11-09",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2"]);
  });

  test("keeps an added day that's also the rule's last day", () => {
    // Daily COUNT=5 Nov 1–5 with an RDATE on Nov 5 (a rule day too), split
    // at Nov 3 and moved to Nov 4: the new part runs Nov 4–6.
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "RDATE;VALUE=DATE:20261105",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("tells an added day that's a rule day from an earlier extra one", () => {
    // Weekly Mon/Wed COUNT=4 (Nov 2, 4, 9, 11) plus an added Tue Nov 3 and
    // an added Nov 11 that's also a rule day, split at Nov 4: three left.
    expect(
      carried(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"], {
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
          "RDATE;VALUE=DATE:20261103,20261111",
        ],
        originalStart: "2026-11-04",
        seriesStart: "2026-11-02",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3"]);
    // A make-up day before the series and an added rule day.
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "RDATE;VALUE=DATE:20261030,20261105",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("counts a first start that isn't a rule day as the first", () => {
    // Weekly on Mondays, first start Sun Nov 1 (made elsewhere): Google
    // meets Nov 1, 2, 9; split at Nov 9 leaves one.
    expect(
      carried(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3"], {
        masterRecurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3"],
        originalStart: "2026-11-09",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"]);
  });

  test("carries a weekly COUNT exactly onto new days, with an added rule day", () => {
    // Mondays Nov 2, 9, 16 (COUNT=3) plus added Nov 3 and Nov 16, split at
    // Nov 9 and moved to Tuesdays: two left (Nov 10, 17).
    expect(
      carried(["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3"], {
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
          "RDATE;VALUE=DATE:20261103,20261116",
        ],
        originalStart: "2026-11-09",
        seriesStart: "2026-11-02",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2"]);
  });

  test("walks a first-Monday-of-the-month rule (BYDAY with BYMONTHDAY)", () => {
    // BYDAY=MO with the 1st to 7th, COUNT=3 from Jun 1 2026: Jun 1, Jul 6,
    // Aug 3. Split at Jul 6: two left.
    expect(
      carried(
        ["RRULE:FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1,2,3,4,5,6,7;COUNT=3"],
        {
          masterRecurrence: [
            "RRULE:FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1,2,3,4,5,6,7;COUNT=3",
          ],
          originalStart: "2026-07-06",
          seriesStart: "2026-06-01",
          seriesZone: "America/New_York",
        }
      )
    ).toEqual(["RRULE:FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1,2,3,4,5,6,7;COUNT=2"]);
  });

  test("walks a single-hour weekly rule with added days", () => {
    // Mondays 9:00 Nov 2/9/16 COUNT=3 with added Nov 3 and Nov 16, split at
    // Nov 9 onto Tuesdays: two left.
    expect(
      carried(["RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=9;COUNT=3"], {
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;COUNT=3",
          "RDATE;VALUE=DATE:20261103,20261116",
        ],
        originalStart: "2026-11-09T09:00:00-05:00",
        seriesStart: "2026-11-02T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=9;COUNT=2"]);
  });

  test("doesn't count added days at the rule's own time", () => {
    // Daily 9:00 five times from Nov 1, with Nov 2 and Nov 4 9:00 added
    // too: two positions before the Nov 3 split, three left.
    const rule = "RRULE:FREQ=DAILY;COUNT=5";
    const added = "RDATE:20261102T090000Z,20261104T090000Z";
    expect(
      carried([rule, added], {
        masterRecurrence: [rule, added],
        originalStart: "2026-11-03T09:00:00Z",
        seriesStart: "2026-11-01T09:00:00Z",
        seriesZone: "UTC",
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3", added]);
  });

  describe("a yearly COUNT=100 from 1950, split in 2026", () => {
    const rule = "RRULE:FREQ=YEARLY;COUNT=100";
    const countOn = (lines: string[]) =>
      carried([rule, ...lines], {
        masterRecurrence: [rule, ...lines],
        originalStart: "2026-11-09T09:00:00Z",
        seriesStart: "1950-11-09T09:00:00Z",
        seriesZone: "UTC",
      });

    test("counts a skip written twice once", () => {
      // 2025 skipped (twice over): 76 used, 24 left.
      const skip = "EXDATE:20251109T090000Z,20251109T090000Z";
      expect(countOn([skip])).toEqual(["RRULE:FREQ=YEARLY;COUNT=24", skip]);
    });

    test("counts no added day, and no skip past the last meeting", () => {
      // An added Dec 1 2020, and a stale skip in 2051, after the rule's
      // last meeting (2049): 2026 to 2049 are left.
      const lines = ["RDATE:20201201T090000Z", "EXDATE:20511109T090000Z"];
      expect(countOn(lines)).toEqual(["RRULE:FREQ=YEARLY;COUNT=24", ...lines]);
    });
  });

  test("finds no positions left past the COUNT's end", () => {
    // Mondays three times from Nov 30 end Dec 14: none left at Jan 4.
    expect(
      countLeft({
        originalStart: "2027-01-04T09:00:00-05:00",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3"],
        seriesStart: { dateTime: "2026-11-30T09:00:00-05:00" },
        seriesZone: "America/New_York",
      })
    ).toBe(0);
  });

  test("counts from Google's list across a clock change, skips it doesn't list in", () => {
    // Daily 2:30 AM New York ten times from Mar 10 2027, Mar 12 and Mar 17
    // skipped (Google doesn't list them); Mar 14's 2:30 doesn't exist, and
    // Google lists it at 3:30. Before a split at Mar 16: Mar 10 to 15, the
    // skipped Mar 12 in, six positions, so four are left.
    const rule = "RRULE:FREQ=DAILY;COUNT=10";
    const skips = "EXDATE:20270312T073000Z,20270317T063000Z";
    expect(
      carried([rule, skips], {
        masterRecurrence: [rule, skips],
        originalStart: "2027-03-16T02:30:00-04:00",
        seriesStart: "2027-03-10T02:30:00-05:00",
        seriesZone: "America/New_York",
        starts: [
          "2027-03-10T02:30:00-05:00",
          "2027-03-11T02:30:00-05:00",
          "2027-03-13T02:30:00-05:00",
          "2027-03-14T03:30:00-04:00",
          "2027-03-15T02:30:00-04:00",
          "2027-03-16T02:30:00-04:00",
          "2027-03-18T02:30:00-04:00",
          "2027-03-19T02:30:00-04:00",
        ],
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=4", skips]);
  });

  test("counts from Google's list across a clock change, around added days at another time", () => {
    // Daily 2:30 AM New York five times from Mar 12 2027 (Mar 14's 2:30
    // doesn't exist, and Google lists nothing then), with meetings added
    // Mar 13 and 16 at 9:00. Split at Mar 15: Mar 15, 16 and 17 are left.
    const rule = "RRULE:FREQ=DAILY;COUNT=5";
    const added = "RDATE:20270313T140000Z,20270316T130000Z";
    expect(
      carried([rule, added], {
        masterRecurrence: [rule, added],
        originalStart: "2027-03-15T02:30:00-04:00",
        seriesStart: "2027-03-12T02:30:00-05:00",
        seriesZone: "America/New_York",
        starts: [
          "2027-03-12T02:30:00-05:00",
          "2027-03-13T02:30:00-05:00",
          "2027-03-13T09:00:00-05:00",
          "2027-03-15T02:30:00-04:00",
          "2027-03-16T02:30:00-04:00",
          "2027-03-16T09:00:00-04:00",
          "2027-03-17T02:30:00-04:00",
        ],
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3", added]);
  });

  test("can't tell a count from Google's list with a skip on the day the clocks skip", () => {
    // As above, Mar 14 skipped (at 2:30, a time it doesn't have) and not
    // listed: whether Google had a meeting there can't be told.
    const rule = "RRULE:FREQ=DAILY;COUNT=5";
    const skip = "EXDATE;TZID=America/New_York:20270314T023000";
    expect(
      carried([rule, skip], {
        masterRecurrence: [rule, skip],
        originalStart: "2027-03-15T02:30:00-04:00",
        seriesStart: "2027-03-12T02:30:00-05:00",
        seriesZone: "America/New_York",
        starts: [
          "2027-03-12T02:30:00-05:00",
          "2027-03-13T02:30:00-05:00",
          "2027-03-15T02:30:00-04:00",
          "2027-03-16T02:30:00-04:00",
        ],
      })
    ).toBeNull();
  });

  test("can't tell a count across a clock change at the series' time", () => {
    // Daily 2:30 AM New York from Mar 7 2026: Mar 8's 2:30 doesn't exist.
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=3"], {
        masterRecurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
        originalStart: "2026-03-09T02:30:00-04:00",
        seriesStart: "2026-03-07T02:30:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toBeNull();
  });
});

describe("a COUNT carried by a move to another calendar", () => {
  test("the moved part runs the meetings left", async () => {
    // Mondays five times from Nov 9; from Nov 23 (the third) moved to
    // another calendar, three are left.
    const counted: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5"],
    };
    const opened = occurrenceOf(counted, "2026-11-23T09:00:00-05:00");
    const google = fakeGoogle(counted, [opened]);
    expect(
      Exit.isSuccess(
        await run(
          service().moveEvent("primary", opened.id, "work", "following")
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
    ]);
  });
});

describe("a COUNT through a move to a day its rule doesn't meet", () => {
  test("runs the meetings left, the moved one's old slot skipped", async () => {
    // Mondays four times from Nov 9; from Nov 16, moved to Sun Nov 15 with
    // the Monday rule kept. The new series meets Sun 15, Nov 23 and Nov 30:
    // Mon 16 is skipped, and takes one of the COUNT's places.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4"],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-15T09:30:00-05:00", timeZone: zone },
            recurrence: series.recurrence,
            start: { dateTime: "2026-11-15T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      "EXDATE:20261116T140000Z",
    ]);
  });
});

describe("a COUNT through a move to a day its rule doesn't meet, with more", () => {
  const series: Event = {
    ...weekly,
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4"],
  };
  const move = (from: string, to: string) =>
    edit("following", occurrenceOf(series, from), {
      end: { dateTime: to.replace("T10:00", "T10:30"), timeZone: zone },
      recurrence: series.recurrence,
      start: { dateTime: to, timeZone: zone },
    });

  test("places a deleted meeting against the COUNT the series ends up with", async () => {
    // Nov 30 deleted on its own; from Nov 16, moved to Sun Nov 15 at 10:00.
    // The new series meets Sun 15, Nov 23 and Nov 30 at 10:00 (Mon 16
    // skipped), so Nov 30's skip goes to 10:00.
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          move("2026-11-16T09:00:00-05:00", "2026-11-15T10:00:00-05:00")
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      "EXDATE:20261130T150000Z,20261116T150000Z",
    ]);
  });

  test("from the last meeting, keeps the one saved and adds none", async () => {
    // From Nov 30, the last, moved to Sun Nov 29 at 10:00: one meeting.
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          move("2026-11-30T09:00:00-05:00", "2026-11-29T10:00:00-05:00")
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"],
      start: { dateTime: "2026-11-29T10:00:00-05:00" },
    });
  });
});

describe("a COUNT the user set, through a move to a day its rule doesn't meet", () => {
  test("takes one more place for the moved meeting's skip", async () => {
    // Mondays four times from Nov 9; from Nov 16, set to twice and moved to
    // Sun Nov 15, the Monday rule kept: Sun 15 and Mon 23, Mon 16 skipped.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4"],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-15T09:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2"],
            start: { dateTime: "2026-11-15T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
      "EXDATE:20261116T140000Z",
    ]);
  });
});

describe("a COUNT through a move whose old slot is only an added day", () => {
  test("isn't raised for the skip: an added day takes no COUNT place", async () => {
    // Mondays four times from Nov 9 plus an added Nov 16 9:00; from Nov 16,
    // moved to Sun Nov 15 on Tuesdays twice, the added day kept. The new
    // rule doesn't meet Mondays, so Nov 16's skip is of the added day.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        "RDATE:20261116T140000Z",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-15T09:30:00-05:00", timeZone: zone },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2",
              "RDATE:20261116T140000Z",
            ],
            start: { dateTime: "2026-11-15T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2"
    );
  });
});

describe("a COUNT through a move onto a deleted meeting", () => {
  test("drops that meeting's place: it's the one just saved", async () => {
    // Mondays four times from Nov 9, Nov 23 deleted on its own; from Nov
    // 16, moved to Nov 23. Left: Nov 23 (the moved one) and Nov 30.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4"],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-23T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-23T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2",
    ]);
  });
});

describe("a week-number COUNT through a move onto a deleted meeting", () => {
  test("drops that meeting's place too", async () => {
    // Monday of week 46 four times from 2026, 2028's deleted on its own; from 2027, moved to 2028's: 2028 (the moved one)
    // and 2029 are left.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=4"],
    };
    const deleted = {
      ...occurrenceOf(series, "2028-11-13T09:00:00-05:00"),
      status: "cancelled",
    };
    const google = fakeGoogle(series, [deleted]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2027-11-15T09:00:00-05:00"), {
            end: { dateTime: "2028-11-13T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2028-11-13T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2",
    ]);
  });
});

describe("a week-number COUNT through a move onto a skip", () => {
  // As above, 2028 skipped in the rule instead.
  const series: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=4",
      "EXDATE:20281113T140000Z",
    ],
  };
  const moveFrom2027 = () =>
    edit("following", occurrenceOf(series, "2027-11-15T09:00:00-05:00"), {
      end: { dateTime: "2028-11-13T09:30:00-05:00", timeZone: zone },
      start: { dateTime: "2028-11-13T09:00:00-05:00", timeZone: zone },
    });

  test("drops the skip's place: the move takes it", async () => {
    // Three places are left from 2027; the skipped 2028 is the new start.
    const google = fakeGoogle(series);
    expect(Exit.isSuccess(await run(moveFrom2027()))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2",
    ]);
  });

  test("drops a stale skip past the end, which holds no place", async () => {
    // A 2030 skip, after the rule's last meeting (2029), where the new
    // series' rule meets before its COUNT is cut: it goes, and the count
    // is unchanged.
    const google = fakeGoogle({
      ...series,
      recurrence: [...(series.recurrence ?? []), "EXDATE:20301111T140000Z"],
    });
    expect(Exit.isSuccess(await run(moveFrom2027()))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2",
    ]);
  });
});

describe("a COUNT split more than fifty years in, keeping the series' times", () => {
  test("keeps a later deleted meeting deleted where it is", async () => {
    // Yearly 150 times from 1950, 2028 deleted on its own; renamed from
    // 2026: 74 left, 2028 still skipped.
    const series: Event = {
      end: { dateTime: "1950-11-09T09:30:00Z", timeZone: "UTC" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=150"],
      start: { dateTime: "1950-11-09T09:00:00Z", timeZone: "UTC" },
      summary: "Anniversary",
    };
    const deleted = {
      ...occurrenceOf(series, "2028-11-09T09:00:00Z"),
      status: "cancelled",
    };
    const google = fakeGoogle(series, [deleted]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-09T09:00:00Z"), {
            summary: "Anniversary (new)",
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=74",
      "EXDATE:20281109T090000Z",
    ]);
  });
});

describe("a week-number COUNT through a move onto its last, skipped meeting", () => {
  test("drops that skip's place: the move takes it", async () => {
    // Monday of week 46 four times from 2026, the last (2029) skipped. From 2028, moved onto 2029's
    // place: one meeting was left, the one moved.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=4",
        "EXDATE:20291112T140000Z",
      ],
    };
    const google = fakeGoogle(series, []);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2028-11-13T09:00:00-05:00"), {
            end: { dateTime: "2029-11-12T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2029-11-12T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=1",
    ]);
  });
});

describe("a COUNT through a move that lands two deleted meetings on one place", () => {
  test("drops a place for the second", async () => {
    // All day, daily five times from Nov 9, Nov 11 and 13 deleted on their
    // own; from Nov 10 moved two days on. Both land on Nov 13: two of the
    // four places left were deleted, so the new series meets twice.
    const series: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
      start: { date: "2026-11-09" },
    };
    const onDay = (day: string): Event => ({
      ...series,
      end: { date: Temporal.PlainDate.from(day).add({ days: 1 }).toString() },
      id: `series_${day.replace(/-/g, "")}`,
      originalStartTime: { date: day },
      recurrence: undefined,
      recurringEventId: "series",
      start: { date: day },
    });
    const google = fakeGoogle(series, [
      { ...onDay("2026-11-11"), status: "cancelled" },
      { ...onDay("2026-11-13"), status: "cancelled" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", onDay("2026-11-10"), {
            end: { date: "2026-11-13" },
            start: { date: "2026-11-12" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY;COUNT=3",
      "EXDATE;VALUE=DATE:20261113",
    ]);
  });
});

describe("a monthly COUNT split into the next month", () => {
  const series: Event = {
    ...weekly,
    end: { date: "2026-01-29" },
    recurrence: ["RRULE:FREQ=MONTHLY;COUNT=5"],
    start: { date: "2026-01-28" },
  };
  const onDay = (day: string): Event => ({
    ...series,
    end: { date: Temporal.PlainDate.from(day).add({ days: 1 }).toString() },
    id: `series_${day.replace(/-/g, "")}`,
    originalStartTime: { date: day },
    recurrence: undefined,
    recurringEventId: "series",
    start: { date: day },
  });
  test("keeps each deleted meeting's place a month on", async () => {
    // All day, monthly five times from Jan 28, Apr 28 and May 28 deleted on
    // their own; from Mar 28 moved to Apr 1. Each later meeting's place is
    // a month on (Apr 28's May 1, May 28's Jun 1): only the moved meeting
    // is left.
    const google = fakeGoogle(series, [
      { ...onDay("2026-04-28"), status: "cancelled" },
      { ...onDay("2026-05-28"), status: "cancelled" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", onDay("2026-03-28"), {
            end: { date: "2026-04-02" },
            start: { date: "2026-04-01" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=MONTHLY;COUNT=3",
      "EXDATE;VALUE=DATE:20260501,20260601",
    ]);
  });

  test("ends sooner when skips fall past the end", async () => {
    // All day, monthly five times from Jan 31 (Jan, Mar, May, Jul, Aug
    // 31), May 31, Jul 31 and Aug 31 deleted on their own; from Mar 31
    // moved to Apr 1: only the moved meeting is left.
    const on31st: Event = {
      ...series,
      end: { date: "2026-02-01" },
      start: { date: "2026-01-31" },
    };
    const deleted = (day: string): Event => ({
      ...onDay(day),
      status: "cancelled",
    });
    const google = fakeGoogle(on31st, [
      deleted("2026-05-31"),
      deleted("2026-07-31"),
      deleted("2026-08-31"),
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", onDay("2026-03-31"), {
            end: { date: "2026-04-02" },
            start: { date: "2026-04-01" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toContain(
      "RRULE:FREQ=MONTHLY;COUNT=1"
    );
  });

  test("skips a meeting deleted and skipped in the rule once", async () => {
    // Monthly seven times from Jan 28, Apr 28 deleted, Jul 28 deleted and
    // skipped in the rule too; from Mar 28 moved to Apr 1: Mar, May and Jun
    // are left, a month on each (Apr 1, Jun 1, Jul 1).
    const seven: Event = {
      ...series,
      recurrence: ["RRULE:FREQ=MONTHLY;COUNT=7", "EXDATE;VALUE=DATE:20260728"],
    };
    const google = fakeGoogle(seven, [
      { ...onDay("2026-04-28"), status: "cancelled" },
      { ...onDay("2026-07-28"), status: "cancelled" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", onDay("2026-03-28"), {
            end: { date: "2026-04-02" },
            start: { date: "2026-04-01" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=MONTHLY;COUNT=5",
      "EXDATE;VALUE=DATE:20260501,20260801",
    ]);
  });

  test("counts a meeting skipped twice over once", async () => {
    // As above, May 28 also skipped in the rule: still only the moved
    // meeting is left.
    const skipped: Event = {
      ...series,
      recurrence: [...(series.recurrence ?? []), "EXDATE;VALUE=DATE:20260528"],
    };
    const google = fakeGoogle(skipped, [
      { ...onDay("2026-04-28"), status: "cancelled" },
      { ...onDay("2026-05-28"), status: "cancelled" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", onDay("2026-03-28"), {
            end: { date: "2026-04-02" },
            start: { date: "2026-04-01" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=MONTHLY;COUNT=3",
      "EXDATE;VALUE=DATE:20260501,20260601",
    ]);
  });
});

describe("a COUNT with stale skips at another time", () => {
  test("lets no stale skip take a meeting's place", async () => {
    // Daily 9:00 five times from Nov 9, Nov 12 skipped at 10:00 (stale)
    // and at 9:00; from Nov 10 made all day: Nov 10, 11 and 13 are left.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=DAILY;COUNT=5",
        "EXDATE:20261112T150000Z,20261112T140000Z",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-10T09:00:00-05:00"), {
            end: { date: "2026-11-11" },
            start: { date: "2026-11-10" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY;COUNT=4",
      "EXDATE;VALUE=DATE:20261112",
    ]);
  });

  test("counts from Google's list past them", async () => {
    // Daily 2:30 five times from Mar 12 2027 (Mar 14 has no 2:30, so the
    // count is read from Google's list), with stale 3:30 skips on Mar 13
    // and 16; renamed from Mar 15: Mar 15, 16 and 17 are left.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2027-03-12T03:00:00-05:00", timeZone: zone },
      recurrence: [
        "RRULE:FREQ=DAILY;COUNT=5",
        "EXDATE:20270313T083000Z,20270316T073000Z",
      ],
      start: { dateTime: "2027-03-12T02:30:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(series, [], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? {
            items: [
              "2027-03-12T02:30:00-05:00",
              "2027-03-13T02:30:00-05:00",
              "2027-03-15T02:30:00-04:00",
              "2027-03-16T02:30:00-04:00",
              "2027-03-17T02:30:00-04:00",
            ].map((start) => occurrenceOf(series, start)),
          }
        : undefined
    );
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2027-03-15T02:30:00-04:00"), {
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY;COUNT=3",
      "EXDATE:20270313T083000Z",
      "EXDATE:20270316T073000Z",
    ]);
  });

  test("is refused when the day the clocks skip has a skip Google doesn't list", async () => {
    const series: Event = {
      ...weekly,
      end: { dateTime: "2027-03-12T03:00:00-05:00", timeZone: zone },
      recurrence: [
        "RRULE:FREQ=DAILY;COUNT=5",
        "EXDATE;TZID=America/New_York:20270314T023000",
      ],
      start: { dateTime: "2027-03-12T02:30:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(series, [], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? {
            items: [
              "2027-03-12T02:30:00-05:00",
              "2027-03-13T02:30:00-05:00",
              "2027-03-15T02:30:00-04:00",
              "2027-03-16T02:30:00-04:00",
            ].map((start) => occurrenceOf(series, start)),
          }
        : undefined
    );
    expect(
      await refusalOf(
        edit("following", occurrenceOf(series, "2027-03-15T02:30:00-04:00"), {
          summary: "Planning (new)",
        })
      )
    ).toMatchObject({ data: { reason: "countUnknown" } });
    expect(google.writes()).toEqual([]);
  });
});

describe("a COUNT through a move off the rule's days, the old place also an added day", () => {
  test("keeps that place's COUNT position", async () => {
    // Mondays four times from Nov 9, Nov 16 also an added day; from Nov 16
    // moved to Sun Nov 15, Mondays kept: Nov 15, 23 and 30 are left.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        "RDATE:20261116T140000Z",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-15T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-15T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      "RDATE:20261116T140000Z",
      "EXDATE:20261116T140000Z",
    ]);
  });
});

describe("a COUNT sent with a new repeat", () => {
  test("is the new part's own, so a later changed meeting keeps its place", async () => {
    // Mondays and Wednesdays ten times from Nov 9, Mon Dec 7 renamed; from
    // Nov 23, Fridays added with the COUNT as it was: ten from Nov 23.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10"],
    };
    const google = fakeGoogle(series, [
      { ...occurrenceOf(series, "2026-12-07T09:00:00-05:00"), summary: "Own" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-23T09:00:00-05:00"), {
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10"],
          })
        )
      )
    ).toBe(true);
    const [created, putBack] = google.writes();
    expect(created?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10",
    ]);
    expect(putBack?.body).toMatchObject({ summary: "Own" });
  });
});

describe("a COUNT through a move past a deleted meeting", () => {
  test.each([
    ["Tue Nov 24", "2026-11-24"],
    ["Wed Nov 25", "2026-11-25"],
  ])("drops its place when moved to %s", async (_day, date) => {
    // Mondays four times from Nov 9, Nov 23 deleted on its own: from Nov
    // 16 two meetings are left. Moved past Nov 23, its place is gone, so
    // the new series is the moved meeting and Nov 30.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4"],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: `${date}T09:30:00-05:00`, timeZone: zone },
            start: { dateTime: `${date}T09:00:00-05:00`, timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2"
    );
  });
});

describe("a COUNT through a move onto a meeting skipped twice over", () => {
  test("drops its place once", async () => {
    // Nov 23 both skipped in the rule and deleted on its own; from Nov 16
    // moved to Nov 23: Nov 23 and Nov 30 are left.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        "EXDATE:20261123T140000Z",
      ],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-23T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-23T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2",
    ]);
  });

  test("drops it once when the meeting is also an added day", async () => {
    // Nov 23 is a rule meeting and an added day, deleted on its own; from
    // Nov 16 moved to Nov 23: Nov 23 and Nov 30 are left.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        "RDATE:20261123T140000Z",
      ],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-23T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-23T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toContain(
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2"
    );
  });

  test("doesn't count a skip where nothing met", async () => {
    // A stale skip on Tue Nov 17; from Nov 16 moved there: Nov 17, 23, 30.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
        "EXDATE:20261117T140000Z",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
    ]);
  });
});

describe("a COUNT through a pause", () => {
  test("holds a deleted meeting's own place when a live one moves onto it", async () => {
    // Mondays six times from Nov 9, Dec 7 deleted; from Nov 16 moved to Nov
    // 30. Dec 7 stays deleted on its own day and holds its place: Nov 16
    // (now Nov 30), Nov 23, Nov 30 and Dec 14 are left, four meetings.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6"],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-12-07T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-30T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-30T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5",
      "EXDATE:20261207T140000Z",
    ]);
  });
});

describe("a COUNT through a monthly day rebuilt for a shorter one", () => {
  test("carries the meetings left", async () => {
    // All day, monthly on the 31st five times from Jan 31 (Jan, Mar, May,
    // Jul, Aug 31); from May 31 moved to May 30, the editor sending the
    // 30th with the same COUNT: May, Jul and Aug are left.
    const series: Event = {
      ...weekly,
      end: { date: "2026-02-01" },
      recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=5"],
      start: { date: "2026-01-31" },
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-05-31"), {
            end: { date: "2026-05-31" },
            recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=30;COUNT=5"],
            start: { date: "2026-05-30" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=30;COUNT=3",
    ]);
  });
});

describe("a COUNT the user changed", () => {
  test("is written as they set it", async () => {
    const five: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5"],
    };
    const google = fakeGoogle(five);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(five, "2026-11-23T09:00:00-05:00"), {
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10",
    ]);
  });
});
