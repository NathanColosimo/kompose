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
  service,
  weekly,
  zone,
} from "./google-test-fixtures";

// A COUNT carried on through a split: exactly the meetings left.

/**
 * A split's COUNT both ways the server can carry it: walked from the rule,
 * and counted from Google's list of the series' meetings (`starts`). Null
 * where that way can't tell.
 */
const carried = (
  recurrence: string[],
  params: Parameters<typeof carryCountFromList>[1]
) => ({
  listed: carryCountFromList(recurrence, params)?.recurrence ?? null,
  walked: carryCountExactly(recurrence, params),
});

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
  // Yearly on Nov 9 at 9:00 UTC from 1978, 148 times (to 2125): split more
  // than fifty years in, too far to walk, so what's left is counted from
  // Google's list of its meetings.
  const yearly = (recurrence: string[], startTime = "1978-11-09T09:00:00Z") => {
    const series: Event = {
      end: { dateTime: "1978-11-09T09:30:00Z", timeZone: "UTC" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=148", ...recurrence],
      start: { dateTime: startTime, timeZone: "UTC" },
      summary: "Anniversary",
    };
    // Google lists its meetings with their offsets.
    const listed: Event = {
      ...series,
      start: { dateTime: "1978-11-09T09:00:00Z", timeZone: "UTC" },
    };
    // A skipped meeting is listed as cancelled.
    const meetings = Array.from({ length: 148 }, (_, i) => {
      const meeting = occurrenceOf(listed, `${1978 + i}-11-09T09:00:00Z`);
      return recurrence.includes(`EXDATE:${1978 + i}1109T090000Z`)
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
    // 1977 skip. Split at 2029, 51 are used (1978 to 2028), so 97 are left.
    const { google, rename } = yearly(["EXDATE:19771109T090000Z"]);
    expect(Exit.isSuccess(await run(rename(2029)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=97",
      "EXDATE:19771109T090000Z",
    ]);
  });

  test("counts before the split without a skip from before the series began", async () => {
    // The same 1977 skip, and a 10:00 Nov 9, 2031 skip after the split
    // that the list can't tell from a meeting: counted from the series'
    // start to the split, where 1978 to 2028 are used.
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

  test("counts a skip Google lists as one of its meetings", async () => {
    // Nov 9, 2029 deleted, and listed by Google as cancelled: split at
    // 2030, 52 are used, so 96 are left.
    const { google, rename } = yearly(["EXDATE:20291109T090000Z"]);
    expect(Exit.isSuccess(await run(rename(2030)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=96",
      "EXDATE:20291109T090000Z",
    ]);
  });

  test("counts from the split on when a skip before it can't be told to be a meeting", async () => {
    // Nov 9, 2029 at 10:00 isn't a meeting, but on a rule day it can't be
    // told not to be one; Google lists 2030 to 2125 from the split, so 96
    // are left.
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

  test("refuses when skips it can't place fall on both sides of the split", async () => {
    // Skips on the rule's own days, at another time, that Google doesn't
    // list: whether each is a position can't be told.
    const { google, rename } = yearly([
      "EXDATE:20291109T100000Z",
      "EXDATE:20311109T100000Z",
    ]);
    expect(await refusalOf(rename(2030))).toMatchObject({
      data: { reason: "countUnknown" },
    });
    expect(google.writes()).toEqual([]);
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

describe("a COUNT whose series starts at another time than its rule", () => {
  test("is counted from Google's list from the split on", async () => {
    // From Thu Mar 11 2027 9:00, daily at 2:30 four times: Mar 12, 13, 15
    // and 16 (2:30 doesn't exist on Mar 14). Whether Google counts the 9:00
    // start isn't known, so the walk leaves it; Google lists two of the
    // rule's meetings from Mar 15 on, so two are left.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2027-03-11T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=30;COUNT=4"],
      start: { dateTime: "2027-03-11T09:00:00-05:00", timeZone: zone },
    };
    const listed = [
      "2027-03-11T09:00:00-05:00",
      "2027-03-12T02:30:00-05:00",
      "2027-03-13T02:30:00-05:00",
      "2027-03-15T02:30:00-04:00",
      "2027-03-16T02:30:00-04:00",
    ];
    const google = fakeGoogle(series, [], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? { items: listed.map((start) => occurrenceOf(series, start)) }
        : undefined
    );
    const opened = occurrenceOf(series, "2027-03-15T02:30:00-04:00");
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=30;COUNT=2",
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
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;COUNT=5",
          "EXDATE;VALUE=DATE:20261102",
        ],
        originalStart: "2026-11-03",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
        starts: ["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05"],
      })
    ).toEqual({
      listed: ["RRULE:FREQ=DAILY;COUNT=3"],
      walked: ["RRULE:FREQ=DAILY;COUNT=3"],
    });
  });

  test("counts a skipped day Google also lists only once", () => {
    // The same series, with Google listing the skipped Nov 2 as cancelled.
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
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
    ).toEqual({
      listed: ["RRULE:FREQ=DAILY;COUNT=3"],
      walked: ["RRULE:FREQ=DAILY;COUNT=3"],
    });
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
        starts: [
          "2026-11-01",
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-05",
          "2026-11-20",
        ],
      })
    ).toEqual({ listed: null, walked: ["RRULE:FREQ=DAILY;COUNT=3"] });
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
        starts: [1, 2, 3, 4, 5].map((day) => nyDaily(day)),
      })
    ).toEqual({
      listed: ["RRULE:FREQ=DAILY;COUNT=3"],
      walked: ["RRULE:FREQ=DAILY;COUNT=3"],
    });
  });

  test("counts starts written with fractional seconds", () => {
    expect(
      carried(["RRULE:FREQ=DAILY;COUNT=5"], {
        masterRecurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
        originalStart: "2026-11-03T14:00:00.000Z",
        seriesStart: "2026-11-01T14:00:00.000Z",
        seriesZone: "America/New_York",
        starts: [1, 2, 3, 4, 5].map((day) => `2026-11-0${day}T14:00:00.000Z`),
      })
    ).toEqual({
      listed: ["RRULE:FREQ=DAILY;COUNT=3"],
      walked: ["RRULE:FREQ=DAILY;COUNT=3"],
    });
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

  test("counts a start at another time than its rule's from Google's list, from the split on", () => {
    // Starts Nov 9 9:00, then daily at 8:00 three times. Whether Google
    // counts the 9:00 start isn't known, so the walk leaves it; Google
    // lists three 8:00 meetings from the split at Nov 10, so three are left.
    const rule = "RRULE:FREQ=DAILY;BYHOUR=8;COUNT=3";
    const params = {
      masterRecurrence: [rule],
      originalStart: "2026-11-10T08:00:00-05:00",
      seriesStart: "2026-11-09T09:00:00-05:00",
      seriesZone: "America/New_York",
    };
    expect(carryCountExactly([rule], params)).toBeNull();
    expect(
      carried([rule], {
        ...params,
        starts: [
          "2026-11-09T09:00:00-05:00",
          "2026-11-10T08:00:00-05:00",
          "2026-11-11T08:00:00-05:00",
          "2026-11-12T08:00:00-05:00",
        ],
      })
    ).toEqual({ listed: [rule], walked: null });
  });

  test("leaves a count to Google's list only when a counted day before the split skips its time", () => {
    // Daily at 2:30 three times from Mar 12 2027; New York has no 2:30 on
    // Mar 14. Split at Mar 13, before that day, one is used whatever
    // Google does on Mar 14. Split at Mar 15, whether Mar 14 counted can't
    // be told: left to Google's list.
    const rule = "RRULE:FREQ=DAILY;COUNT=3";
    const carry = (originalStart: string) =>
      carryCountExactly([rule], {
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

  test("leaves a count it can't walk to the split to Google's list", () => {
    // A yearly rule from 1950 a hundred times, split in 2026: more than
    // fifty years to walk, so it isn't guessed from a partial walk.
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

  test("counts from the split on past an added day before it", () => {
    // A week-number rule isn't walked, and Google's list can't tell its
    // meetings before the split from the added Nov 17; from the split on
    // it lists two, so two are left. With an added day on both sides,
    // what's left is unknown.
    const rule = "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=3";
    const params = {
      originalStart: "2027-11-15",
      seriesStart: "2026-11-09",
      seriesZone: "America/New_York",
      starts: ["2026-11-09", "2026-11-17", "2027-11-15", "2028-11-13"],
    };
    expect(
      carried([rule], {
        ...params,
        masterRecurrence: [rule, "RDATE;VALUE=DATE:20261117"],
      })
    ).toEqual({
      listed: ["RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2"],
      walked: null,
    });
    expect(
      carried([rule], {
        ...params,
        masterRecurrence: [rule, "RDATE;VALUE=DATE:20261117,20281120"],
        starts: [...params.starts, "2028-11-20"],
      })
    ).toEqual({ listed: null, walked: null });
  });

  test("carries a COUNT it can't walk when its added days come after the split", () => {
    // The same rule with its added day after the split: the meetings
    // Google lists before the split are all the rule's.
    const rule = "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=3";
    expect(
      carried([rule], {
        masterRecurrence: [rule, "RDATE;VALUE=DATE:20271120"],
        originalStart: "2027-11-15",
        seriesStart: "2026-11-09",
        seriesZone: "America/New_York",
        starts: ["2026-11-09", "2027-11-15", "2027-11-20", "2028-11-13"],
      })
    ).toEqual({
      listed: ["RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2"],
      walked: null,
    });
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
        starts: [
          "2026-11-01",
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-05",
        ],
      })
    ).toEqual({
      listed: ["RRULE:FREQ=DAILY;COUNT=3"],
      walked: ["RRULE:FREQ=DAILY;COUNT=3"],
    });
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
        starts: [
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-09",
          "2026-11-11",
        ],
      })
    ).toEqual({
      listed: null,
      walked: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3"],
    });
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
        starts: [
          "2026-10-30",
          "2026-11-01",
          "2026-11-02",
          "2026-11-03",
          "2026-11-04",
          "2026-11-05",
        ],
      })
    ).toEqual({
      listed: ["RRULE:FREQ=DAILY;COUNT=3"],
      walked: ["RRULE:FREQ=DAILY;COUNT=3"],
    });
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
        starts: ["2026-11-01", "2026-11-02", "2026-11-09"],
      })
    ).toEqual({
      listed: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"],
      walked: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"],
    });
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
        starts: ["2026-11-02", "2026-11-03", "2026-11-09", "2026-11-16"],
      })
    ).toEqual({ listed: null, walked: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2"] });
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

  test("counts from the split on when Google's list finds the COUNT used up before it", () => {
    // From Sun Nov 8, Mondays three times; Google lists Nov 8, 9, 16 and 23
    // (it didn't count the Sunday start). Split at Nov 23: one left.
    const rule = "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3";
    expect(
      carryCountFromList([rule], {
        masterRecurrence: [rule],
        originalStart: "2026-11-23T09:00:00-05:00",
        seriesStart: "2026-11-08T09:00:00-05:00",
        seriesZone: "America/New_York",
        starts: [8, 9, 16, 23].map(
          (day) => `2026-11-${String(day).padStart(2, "0")}T09:00:00-05:00`
        ),
      })?.recurrence ?? null
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"]);
  });

  test("counts a skip Google doesn't list at a meeting of a rule it reads", () => {
    // Daily 2:30 AM New York ten times from Mar 10 2027, Mar 12 and Mar 17
    // skipped (Google doesn't list them); Mar 14's 2:30 doesn't exist, so
    // the rule isn't walked. Before a split at Mar 16: Mar 10 to 15, the
    // skipped Mar 12 in, six positions, so four are left.
    const rule = "RRULE:FREQ=DAILY;COUNT=10";
    const skips = "EXDATE:20270312T073000Z,20270317T063000Z";
    expect(
      carryCountFromList([rule, skips], {
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
      })?.recurrence ?? null
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=4", skips]);
  });

  describe("a yearly COUNT=100 from 1950, split in 2026", () => {
    const rule = "RRULE:FREQ=YEARLY;COUNT=100";
    const years = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const countOn = (lines: string[], starts: string[]) =>
      carryCountFromList([rule, ...lines], {
        masterRecurrence: [rule, ...lines],
        originalStart: "2026-11-09T09:00:00Z",
        seriesStart: "1950-11-09T09:00:00Z",
        seriesZone: "UTC",
        starts,
      })?.recurrence ?? null;
    const onNov9 = (year: number) => `${year}-11-09T09:00:00Z`;

    test("counts a skip written twice once", () => {
      // 2025 skipped (twice over) and not listed: 76 used, 24 left.
      const skip = "EXDATE:20251109T090000Z,20251109T090000Z";
      expect(
        countOn(
          [skip],
          years(1950, 2049)
            .filter((year) => year !== 2025)
            .map(onNov9)
        )
      ).toEqual(["RRULE:FREQ=YEARLY;COUNT=24", skip]);
    });

    test("doesn't count a skip past the last meeting it lists", () => {
      // An added Dec 1 2020 makes the side before the split unclear; a
      // stale skip in 2051, after the rule's last meeting (2049), changes
      // no meeting, counted or not: 2026 to 2049 are left.
      const lines = ["RDATE:20201201T090000Z", "EXDATE:20511109T090000Z"];
      expect(
        countOn(lines, [
          ...years(1950, 2049).map(onNov9),
          "2020-12-01T09:00:00Z",
        ])
      ).toEqual(["RRULE:FREQ=YEARLY;COUNT=24", ...lines]);
    });
  });

  test("leaves a COUNT the walk finds used up before the split to Google's list", () => {
    // Mondays three times from Nov 30 end Dec 14; a split at Jan 4 means
    // the walk and Google disagree.
    const rule = "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3";
    expect(
      carryCountExactly([rule], {
        masterRecurrence: [rule],
        originalStart: "2027-01-04T09:00:00-05:00",
        seriesStart: "2026-11-30T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toBeNull();
  });

  test("doesn't count a skip past the end on the side from the split", () => {
    // 8:00 daily three times, from a 9:00 start (whether Google counts it
    // can't be told), with a stale skip on Nov 20 at 8:00, after the
    // last meeting (Nov 12). From Nov 10: three are left.
    const byHour = "RRULE:FREQ=DAILY;BYHOUR=8;COUNT=3";
    const skip = "EXDATE:20261120T130000Z";
    expect(
      carryCountFromList([byHour, skip], {
        masterRecurrence: [byHour, skip],
        originalStart: "2026-11-10T08:00:00-05:00",
        seriesStart: "2026-11-09T09:00:00-05:00",
        seriesZone: "America/New_York",
        starts: [
          "2026-11-09T09:00:00-05:00",
          "2026-11-10T08:00:00-05:00",
          "2026-11-11T08:00:00-05:00",
          "2026-11-12T08:00:00-05:00",
        ],
      })?.recurrence ?? null
    ).toEqual([byHour, skip]);
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

describe("a COUNT read from Google's list through a move onto a deleted meeting", () => {
  test("drops that meeting's place too", async () => {
    // Monday of week 46 four times from 2026 (a rule not read here), 2028's
    // deleted on its own; from 2027, moved to 2028's: 2028 (the moved one)
    // and 2029 are left.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=4"],
    };
    const deleted = {
      ...occurrenceOf(series, "2028-11-13T09:00:00-05:00"),
      status: "cancelled",
    };
    const google = fakeGoogle(series, [deleted], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? {
            items: [
              occurrenceOf(series, "2026-11-09T09:00:00-05:00"),
              occurrenceOf(series, "2027-11-15T09:00:00-05:00"),
              deleted,
              occurrenceOf(series, "2029-11-12T09:00:00-05:00"),
            ],
          }
        : undefined
    );
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

describe("a COUNT read from Google's list through a move onto a skip", () => {
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
  const listing = (items: Event[]) =>
    fakeGoogle(series, [], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? { items }
        : undefined
    );
  const meeting = (start: string) => occurrenceOf(series, start);

  test("drops its place when Google doesn't list it but the count holds it", async () => {
    // Three places are left from 2027, and Google lists only two of them
    // (2027 and 2029): the skipped 2028 is the third.
    const google = listing([
      meeting("2026-11-09T09:00:00-05:00"),
      meeting("2027-11-15T09:00:00-05:00"),
      meeting("2029-11-12T09:00:00-05:00"),
    ]);
    expect(Exit.isSuccess(await run(moveFrom2027()))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2",
    ]);
  });

  test("is refused when Google doesn't list it and the count can't tell", async () => {
    // A stale skip (2030, past the end) Google doesn't list either: which
    // of the two holds the third place can't be told.
    const google = fakeGoogle(
      {
        ...series,
        recurrence: [...(series.recurrence ?? []), "EXDATE:20301111T140000Z"],
      },
      [],
      (request) =>
        request.url.pathname.endsWith("/events/series/instances") &&
        !request.url.searchParams.get("originalStart")
          ? {
              items: [
                meeting("2026-11-09T09:00:00-05:00"),
                meeting("2027-11-15T09:00:00-05:00"),
                meeting("2029-11-12T09:00:00-05:00"),
              ],
            }
          : undefined
    );
    expect(await refusalOf(moveFrom2027())).toMatchObject({
      data: { reason: "countUnknown" },
    });
    expect(google.writes()).toEqual([]);
  });

  test("drops its place when Google lists it as a meeting", async () => {
    const google = listing([
      meeting("2026-11-09T09:00:00-05:00"),
      meeting("2027-11-15T09:00:00-05:00"),
      { ...meeting("2028-11-13T09:00:00-05:00"), status: "cancelled" },
      meeting("2029-11-12T09:00:00-05:00"),
    ]);
    expect(Exit.isSuccess(await run(moveFrom2027()))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=2",
    ]);
  });
});

describe("a COUNT read from Google's list, the split keeping the series' times", () => {
  test("keeps a later deleted meeting deleted where it is", async () => {
    // Yearly 150 times from 1950, 2028 deleted on its own; renamed from
    // 2026 (past fifty years, so counted from Google's list): 74 left,
    // 2028 still skipped.
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
    const google = fakeGoogle(series, [deleted], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? {
            items: Array.from({ length: 150 }, (_, i) =>
              i + 1950 === 2028
                ? deleted
                : occurrenceOf(series, `${1950 + i}-11-09T09:00:00Z`)
            ),
          }
        : undefined
    );
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

describe("a COUNT read from Google's list, a last skip it doesn't list", () => {
  // 8:00 daily four times from a 9:00 Nov 9 start (whether Google counts it
  // can't be told), Nov 12 skipped and not listed: Nov 10 and 11 are left.
  const series: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=DAILY;BYHOUR=8;COUNT=4",
      "EXDATE:20261112T130000Z",
    ],
  };
  const listing = () =>
    fakeGoogle(series, [], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? {
            items: [
              occurrenceOf(series, "2026-11-09T09:00:00-05:00"),
              occurrenceOf(series, "2026-11-10T08:00:00-05:00"),
              occurrenceOf(series, "2026-11-11T08:00:00-05:00"),
            ],
          }
        : undefined
    );
  const from10 = occurrenceOf(series, "2026-11-10T08:00:00-05:00");

  test.each([
    ["renamed", { summary: "Planning (new)" }],
    [
      "moved to 8:30",
      {
        end: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-10T08:30:00-05:00", timeZone: zone },
      },
    ],
  ])("keeps both when %s", async (_how, changes) => {
    const google = listing();
    expect(Exit.isSuccess(await run(edit("following", from10, changes)))).toBe(
      true
    );
    expect(JSON.stringify(google.writes()[0]?.body?.recurrence)).toContain(
      "COUNT=2"
    );
  });
});

describe("a COUNT read from Google's list, counted before the split", () => {
  test("drops the place of a last skip it doesn't list that the move takes", async () => {
    // Monday of week 46 four times from 2026 (a rule not read here), the
    // last (2029) skipped and not listed. From 2028, moved onto 2029's
    // place: one meeting was left, the one moved.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=YEARLY;BYWEEKNO=46;BYDAY=MO;COUNT=4",
        "EXDATE:20291112T140000Z",
      ],
    };
    const google = fakeGoogle(series, [], (request) =>
      request.url.pathname.endsWith("/events/series/instances") &&
      !request.url.searchParams.get("originalStart")
        ? {
            items: [
              occurrenceOf(series, "2026-11-09T09:00:00-05:00"),
              occurrenceOf(series, "2027-11-15T09:00:00-05:00"),
              occurrenceOf(series, "2028-11-13T09:00:00-05:00"),
            ],
          }
        : undefined
    );
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
    expect(JSON.stringify(google.writes()[0]?.body?.recurrence)).toContain(
      "COUNT=1"
    );
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
