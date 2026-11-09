/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  carryCountExactly,
  carryCountFromList,
  truncateRecurrenceForFollowing,
} from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import { Exit } from "effect";
import {
  edit,
  fakeGoogle,
  occurrenceOf,
  refusalOf,
  run,
} from "./google-test-fixtures";

// A COUNT carried on through a split: exactly the meetings left.

/** A split's COUNT as the server carries it: walked, or from Google's list. */
const carryCount = (
  recurrence: string[],
  params: Parameters<typeof carryCountFromList>[1]
) =>
  carryCountExactly(recurrence, params) ??
  carryCountFromList(recurrence, params);

describe("a COUNT too long to walk", () => {
  test("a COUNT past fifty years is carried from Google's list, not a partial walk", async () => {
    // Yearly a hundred times from 1950: split in 2026, 24 are left.
    const series: Event = {
      end: { dateTime: "1950-11-09T09:30:00Z", timeZone: "UTC" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=100"],
      start: { dateTime: "1950-11-09T09:00:00Z", timeZone: "UTC" },
      summary: "Anniversary",
    };
    const years = Array.from({ length: 100 }, (_, i) => 1950 + i);
    const google = fakeGoogle(series, [], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? {
            items: years.map((year) =>
              occurrenceOf(series, `${year}-11-09T09:00:00Z`)
            ),
          }
        : undefined
    );
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

describe("a COUNT carried from Google's list", () => {
  // Yearly on Nov 9 at 9:00 UTC from 2028, 98 times: too long to walk, so
  // what's left is counted from Google's list of its meetings.
  const yearly = (recurrence: string[], startTime = "2028-11-09T09:00:00Z") => {
    const series: Event = {
      end: { dateTime: "2028-11-09T09:30:00Z", timeZone: "UTC" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=98", ...recurrence],
      start: { dateTime: startTime, timeZone: "UTC" },
      summary: "Anniversary",
    };
    // Google lists its meetings with their offsets.
    const listed: Event = {
      ...series,
      start: { dateTime: "2028-11-09T09:00:00Z", timeZone: "UTC" },
    };
    // A skipped meeting is listed as cancelled.
    const meetings = Array.from({ length: 98 }, (_, i) => {
      const meeting = occurrenceOf(listed, `${2028 + i}-11-09T09:00:00Z`);
      return recurrence.includes(`EXDATE:${2028 + i}1109T090000Z`)
        ? { ...meeting, status: "cancelled" }
        : meeting;
    });
    const google = fakeGoogle(series, [], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? { items: meetings }
        : undefined
    );
    const rename = (year: number) =>
      edit("following", occurrenceOf(listed, `${year}-11-09T09:00:00Z`), {
        summary: "Anniversary (new)",
      });
    return { google, rename };
  };

  test("doesn't count a skip from before the series began", async () => {
    // Left by an earlier split: still carrying the old series' Nov 9,
    // 2027 skip. Split at 2029, one is used (2028), so 97 are left.
    const { google, rename } = yearly(["EXDATE:20271109T090000Z"]);
    expect(Exit.isSuccess(await run(rename(2029)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=97",
      "EXDATE:20271109T090000Z",
    ]);
  });

  test("counts a skip Google lists as one of its meetings", async () => {
    // Nov 9, 2029 deleted, and listed by Google as cancelled: split at
    // 2030, two are used, so 96 are left.
    const { google, rename } = yearly(["EXDATE:20291109T090000Z"]);
    expect(Exit.isSuccess(await run(rename(2030)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=96",
      "EXDATE:20291109T090000Z",
    ]);
  });

  test("refuses when a skip can't be told to be one of its meetings", async () => {
    // Dec 1, 2029 isn't a meeting, but the rule can't be walked to show
    // it: counting it would end the new series a meeting early.
    const { google, rename } = yearly(["EXDATE:20291201T090000Z"]);
    expect(await refusalOf(rename(2030))).toMatchObject({
      data: { reason: "countUnknown" },
    });
    expect(google.writes()).toEqual([]);
  });

  test("reads a series start Google wrote without an offset", async () => {
    const { google, rename } = yearly([], "2028-11-09T09:00:00");
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
        carryCountExactly([rule ?? ""], {
          masterRecurrence: [rule ?? ""],
          originalStart: "2026-11-03",
          seriesStart: "2026-11-01",
          seriesZone: "America/New_York",
        })
      ).toEqual([left ?? ""]);
    }
  });

  test("carries a COUNT on by rule positions, skipped ones in", () => {
    // Daily COUNT=5 from Nov 1, Nov 2 skipped, split at Nov 3: Google lists
    // Nov 1, 3, 4, 5; two positions are used before the split, three left.
    expect(
      carryCount(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "EXDATE;VALUE=DATE:20261102",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
        starts: ["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05"],
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("counts a skipped day Google also lists only once", () => {
    // The same series, with Google listing the skipped Nov 2 as cancelled.
    expect(
      carryCount(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "EXDATE;VALUE=DATE:20261102",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
        starts: [
          "2026-11-01",
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-05",
        ],
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("carries a COUNT on exactly with added days", () => {
    // Daily COUNT=5 from Nov 1 plus an RDATE on Nov 2 (a rule day too) and
    // Nov 20: walked, the rule's days are Nov 1–5, three from Nov 3.
    expect(
      carryCount(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "RDATE;VALUE=DATE:20261102,20261120",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
        starts: [
          "2026-11-01",
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-05",
          "2026-11-20",
        ],
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  // Google's own date-times: New York's offset is negative.
  const nyDaily = (day: number, hour = 9) =>
    `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00-05:00`;

  test("counts timed occurrences written with a negative offset", () => {
    expect(
      carryCount(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
        originalStart: nyDaily(3),
        seriesStart: nyDaily(1),
        seriesZone: "America/New_York",
        starts: [1, 2, 3, 4, 5].map((day) => nyDaily(day)),
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("counts starts written with fractional seconds", () => {
    expect(
      carryCount(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
        originalStart: "2026-11-03T14:00:00.000Z",
        seriesStart: "2026-11-01T14:00:00.000Z",
        seriesZone: "America/New_York",
        starts: [1, 2, 3, 4, 5].map((day) => `2026-11-0${day}T14:00:00.000Z`),
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("cuts a rule with a list of times where Google ends it", () => {
    // Mondays with BYHOUR=9,15 four times from Nov 30: Google meets once a
    // day, at the start's 9:00 (Nov 30 to Dec 21). Split at Dec 14, the
    // old part ends the second before and the new one has two left.
    const rule = "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15;COUNT=4";
    expect(
      truncateRecurrenceForFollowing(
        [rule],
        "2026-12-14T09:00:00-05:00",
        "America/New_York",
        "2026-11-30T09:00:00-05:00"
      )
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15;UNTIL=20261214T135959Z",
    ]);
    expect(
      carryCountExactly([rule], {
        masterRecurrence: [rule],
        originalStart: "2026-12-14T09:00:00-05:00",
        seriesStart: "2026-11-30T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15;COUNT=2"]);
  });

  test("counts no meeting before the series' start", () => {
    // Starts Nov 9 9:00, then daily at 8:00 three times: Nov 9's 8:00 is
    // before the start, so the rule meets Nov 10, 11 and 12. Split at
    // Nov 10 8:00, all three are left.
    const rule = "RRULE:FREQ=DAILY;BYHOUR=8;COUNT=3";
    expect(
      carryCountExactly([rule], {
        masterRecurrence: [rule],
        originalStart: "2026-11-10T08:00:00-05:00",
        seriesStart: "2026-11-09T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toEqual([rule]);
  });

  test("leaves a count to Google's list only when a counted day skips its time", () => {
    // Daily at 2:30 three times from a 9:00 start; New York has no 2:30
    // on Mar 14 2027. From Mar 11, the meetings run through Mar 14: left
    // to Google's list. From Mar 14 itself, that 2:30 is before the
    // start, so the meetings (Mar 15-17) can be counted.
    const rule = "RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=30;COUNT=3";
    const carry = (seriesStart: string, originalStart: string) =>
      carryCountExactly([rule], {
        masterRecurrence: [rule],
        originalStart,
        seriesStart,
        seriesZone: "America/New_York",
      });
    expect(
      carry("2027-03-11T09:00:00-05:00", "2027-03-12T02:30:00-05:00")
    ).toBeNull();
    expect(
      carry("2027-03-14T09:00:00-04:00", "2027-03-16T02:30:00-04:00")
    ).toEqual(["RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=30;COUNT=2"]);
  });

  test("leaves a count it can't walk to its end to Google's list", () => {
    // Feb 30 never comes, so the rule's three meetings aren't found within
    // the walk; and a yearly rule from 1950 a hundred times runs past
    // fifty years. Neither is guessed from a partial walk.
    const never = [
      "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30;BYHOUR=15;COUNT=3",
    ];
    expect(
      carryCountExactly(never, {
        masterRecurrence: never,
        originalStart: "2027-03-12T09:00:00-05:00",
        seriesStart: "2027-03-11T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toBeNull();
    const yearly = ["RRULE:FREQ=YEARLY;COUNT=100"];
    expect(
      carryCountExactly(yearly, {
        masterRecurrence: yearly,
        originalStart: "2026-11-09T09:00:00Z",
        seriesStart: "1950-11-09T09:00:00Z",
        seriesZone: "UTC",
      })
    ).toBeNull();
  });

  test("can't carry a COUNT it can't walk past added days", () => {
    // A week-number rule isn't walked, and Google's list can't tell its
    // meetings from the added one: what's left is unknown.
    const rule = "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=3";
    expect(
      carryCount([rule], {
        masterRecurrence: [rule, "RDATE;VALUE=DATE:20261117"],
        originalStart: "2027-11-15",
        seriesStart: "2026-11-09",
        seriesZone: "America/New_York",
        starts: ["2026-11-09", "2026-11-17", "2027-11-15", "2028-11-13"],
      })
    ).toBeNull();
  });

  test("carries a COUNT it can't walk when its added days come after the split", () => {
    // The same rule with its added day after the split: the meetings
    // Google lists before the split are all the rule's.
    const rule = "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=3";
    expect(
      carryCount([rule], {
        masterRecurrence: [rule, "RDATE;VALUE=DATE:20271120"],
        originalStart: "2027-11-15",
        seriesStart: "2026-11-09",
        seriesZone: "America/New_York",
        starts: ["2026-11-09", "2027-11-15", "2027-11-20", "2028-11-13"],
      })
    ).toEqual(["RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2"]);
  });

  test("keeps an added day that's also the rule's last day", () => {
    // Daily COUNT=5 Nov 1–5 with an RDATE on Nov 5 (a rule day too), split
    // at Nov 3 and moved to Nov 4: the new part runs Nov 4–6.
    expect(
      carryCount(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "RDATE;VALUE=DATE:20261105",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
        starts: [
          "2026-11-01",
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-05",
        ],
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("tells an added day that's a rule day from an earlier extra one", () => {
    // Weekly Mon/Wed COUNT=4 (Nov 2, 4, 9, 11) plus an added Tue Nov 3 and
    // an added Nov 11 that's also a rule day, split at Nov 4: three left.
    expect(
      carryCount(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"], {
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
          "RDATE;VALUE=DATE:20261103,20261111",
        ],
        originalStart: "2026-11-04",
        seriesStart: "2026-11-02",
        seriesZone: "America/New_York",
        starts: [
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-09",
          "2026-11-11",
        ],
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3"]);
    // A make-up day before the series and an added rule day.
    expect(
      carryCount(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "RDATE;VALUE=DATE:20261030,20261105",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
        starts: [
          "2026-10-30",
          "2026-11-01",
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-05",
        ],
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("counts a first start that isn't a rule day as the first", () => {
    // Weekly on Mondays, first start Sun Nov 1 (made elsewhere): Google
    // meets Nov 1, 2, 9; split at Nov 9 leaves one.
    expect(
      carryCount(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3"], {
        masterRecurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3"],
        originalStart: "2026-11-09",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
        starts: ["2026-11-01", "2026-11-02", "2026-11-09"],
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"]);
  });

  test("carries a weekly COUNT exactly onto new days, with an added rule day", () => {
    // Mondays Nov 2, 9, 16 (COUNT=3) plus added Nov 3 and Nov 16, split at
    // Nov 9 and moved to Tuesdays: two left (Nov 10, 17).
    expect(
      carryCount(["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3"], {
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
          "RDATE;VALUE=DATE:20261103,20261116",
        ],
        originalStart: "2026-11-09",
        seriesStart: "2026-11-02",
        seriesZone: "America/New_York",
        starts: ["2026-11-02", "2026-11-03", "2026-11-09", "2026-11-16"],
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2"]);
  });

  test("walks a first-Monday-of-the-month rule (BYDAY with BYMONTHDAY)", () => {
    // BYDAY=MO with the 1st to 7th, COUNT=3 from Jun 1 2026: Jun 1, Jul 6,
    // Aug 3. Split at Jul 6: two left.
    expect(
      carryCountExactly(
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
      carryCountExactly(["RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=9;COUNT=3"], {
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

  test("leaves a count across a DST gap to Google's list", () => {
    // Daily 2:30 AM New York from Mar 7 2026: Mar 8's 2:30 doesn't exist.
    expect(
      carryCountExactly(["RRULE:FREQ=DAILY;COUNT=3"], {
        masterRecurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
        originalStart: "2026-03-09T02:30:00-04:00",
        seriesStart: "2026-03-07T02:30:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toBeNull();
  });
});
