/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  carryCount,
  carryCountExactly,
  hasAddedDays,
  splitAddedDays,
  truncateRecurrenceForFollowing,
  withRemainingCount,
} from "@kompose/google-cal/recurrence-utils";
import { isRuleDay } from "@kompose/google-cal/rule-days";
import { matchRecurrenceToStart } from "@kompose/google-cal/until";
import { Temporal } from "temporal-polyfill";

const COUNT_VALUE = /COUNT=(\d+)/;

describe("splitting a series", () => {
  test("ends an all-day series the day before, as a date", () => {
    expect(
      truncateRecurrenceForFollowing(
        ["EXDATE;VALUE=DATE:20261103", "RRULE:FREQ=DAILY;COUNT=10"],
        "2026-11-10"
      )
    ).toEqual([
      "EXDATE;VALUE=DATE:20261103",
      "RRULE:FREQ=DAILY;UNTIL=20261109",
    ]);
  });

  test("ends a timed series the second before, in UTC", () => {
    expect(
      truncateRecurrenceForFollowing(
        ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270101T000000Z"],
        "2026-11-10T09:00:00-05:00"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261110T135959Z"]);
  });

  test("cuts a rule written COUNT-first without an empty part", () => {
    expect(
      truncateRecurrenceForFollowing(
        ["RRULE:COUNT=5;FREQ=DAILY"],
        "2026-11-10T09:00:00-05:00"
      )
    ).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261110T135959Z"]);
  });

  test("carries on a kept COUNT from where the series is cut", () => {
    // A five-time series split at its third: three left.
    expect(withRemainingCount(["RRULE:FREQ=DAILY;COUNT=5"], 2)).toEqual([
      "RRULE:FREQ=DAILY;COUNT=3",
    ]);
    expect(withRemainingCount(["RRULE:COUNT=5;FREQ=DAILY"], 2)).toEqual([
      "RRULE:COUNT=3;FREQ=DAILY",
    ]);
    expect(withRemainingCount(["RRULE:FREQ=DAILY"], 2)).toEqual([
      "RRULE:FREQ=DAILY",
    ]);
  });

  test("gives each part its own added days", () => {
    const rule = ["RRULE:FREQ=WEEKLY", "RDATE;VALUE=DATE:20261101,20261109"];
    // The old part ends before Nov 3: Nov 9 isn't its any more.
    expect(
      truncateRecurrenceForFollowing(rule, "2026-11-03", "America/New_York")
    ).toEqual([
      "RRULE:FREQ=WEEKLY;UNTIL=20261102",
      "RDATE;VALUE=DATE:20261101",
    ]);
    expect(
      splitAddedDays(rule, "2026-11-03", "America/New_York", "from")
    ).toEqual(["RRULE:FREQ=WEEKLY", "RDATE;VALUE=DATE:20261109"]);
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
    // Feb 30 never comes, so the first rule's three meetings aren't found
    // within the walk; and a yearly rule from 1950 a hundred times runs
    // past fifty years. Neither is guessed from a partial walk.
    const never = [
      "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30;BYHOUR=15;COUNT=3",
      "RRULE:FREQ=DAILY;COUNT=5",
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

  test("counts each counted rule on its own", () => {
    // Daily COUNT=10 and Mondays COUNT=5 from Mon Nov 9, split at Nov 16:
    // three days left (16-18) and four Mondays (Nov 16 to Dec 7).
    const rules = [
      "RRULE:FREQ=DAILY;COUNT=10",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5",
    ];
    const split = (originalStart: string) =>
      carryCountExactly(rules, {
        masterRecurrence: rules,
        originalStart,
        seriesStart: "2026-11-09",
        seriesZone: "America/New_York",
      });
    expect(split("2026-11-16")).toEqual([
      "RRULE:FREQ=DAILY;COUNT=3",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
    ]);
    // Split at Dec 7 (the daily rule's own count is spent, so it's done):
    // the Mondays rule has one left and carries the part; split past its
    // last, a later rule is dropped.
    expect(split("2026-12-07")).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"]);
    expect(
      carryCountExactly(
        ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10", "RRULE:FREQ=DAILY;COUNT=3"],
        {
          masterRecurrence: [
            "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10",
            "RRULE:FREQ=DAILY;COUNT=3",
          ],
          originalStart: "2026-11-16",
          seriesStart: "2026-11-09",
          seriesZone: "America/New_York",
        }
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=9"]);
  });

  test("counts each rule's positions at its own time", () => {
    // Daily 9:00 and 15:00 rules, COUNT=5 each, from Nov 9 at 9:00; split
    // Nov 11 at 15:00: the 9:00 rule used Nov 9, 10, 11 (two left), the
    // 15:00 one Nov 9 (the series' start), Nov 10 (three left). The new
    // start (15:00) counts only for a rule at its time, as the series'
    // start does, so neither keeps more.
    const rules = [
      "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=5",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
    ];
    expect(
      carryCountExactly(rules, {
        masterRecurrence: rules,
        originalStart: "2026-11-11T15:00:00-05:00",
        seriesStart: "2026-11-09T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toEqual([
      "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=2",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=3",
    ]);
    // Split at 15:00 on the first day: only the 9:00 rule's first is gone.
    expect(
      carryCountExactly(rules, {
        masterRecurrence: rules,
        originalStart: "2026-11-09T15:00:00-05:00",
        seriesStart: "2026-11-09T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toEqual([
      "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=4",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
    ]);
  });

  test("counts the series' start only for a rule at its time", () => {
    // Mondays at 9:00 (the series' start, Mon Nov 9) and Tuesdays at 15:00:
    // the Tuesday rule's days are Nov 10, 17, 24, never the Monday start.
    // Split Tue Nov 17 at 15:00: two Mondays and one Tuesday used. The
    // Mondays rule has no time of its own, so it meets at the new start's
    // 15:00, and that start, not a Monday, counts as one more of its own.
    const rules = [
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      "RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=15;COUNT=3",
    ];
    expect(
      carryCountExactly(rules, {
        masterRecurrence: rules,
        originalStart: "2026-11-17T15:00:00-05:00",
        seriesStart: "2026-11-09T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
      "RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=15;COUNT=2",
    ]);
  });

  test("counts a rule's list of times as one meeting a day", () => {
    // Google meets BYHOUR=9,15 once a day, at the start's 9:00: ten
    // meetings from Nov 9 run to Nov 18, so split at Nov 11 eight are
    // left, and made all day the rule keeps them.
    const rule = ["RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=10"];
    const carried = carryCountExactly(rule, {
      masterRecurrence: rule,
      originalStart: "2026-11-11T09:00:00-05:00",
      seriesStart: "2026-11-09T09:00:00-05:00",
      seriesZone: "America/New_York",
    });
    expect(carried).toEqual(["RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=8"]);
    expect(
      matchRecurrenceToStart(
        carried ?? [],
        { date: "2026-11-11" },
        "America/New_York",
        { dateTime: "2026-11-09T09:00:00-05:00" },
        {
          firstDay: Temporal.PlainDate.from("2026-11-11"),
          firstTime: Temporal.PlainTime.from("09:00"),
        }
      )
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=8"]);
  });

  test("counts a split at an added meeting as one more", () => {
    // Daily 9:00 five times from Nov 9, plus an added Nov 9 15:00: split
    // there ("This and following"), the new part's start is a meeting the
    // rule doesn't make, so the rule's four left (Nov 10-13) need COUNT=5.
    // Made all day from that start, it runs Nov 9-13.
    const carried = carryCountExactly(["RRULE:FREQ=DAILY;COUNT=5"], {
      masterRecurrence: [
        "RRULE:FREQ=DAILY;COUNT=5",
        "RDATE;TZID=America/New_York:20261109T150000",
      ],
      originalStart: "2026-11-09T15:00:00-05:00",
      seriesStart: "2026-11-09T09:00:00-05:00",
      seriesZone: "America/New_York",
    });
    expect(carried).toEqual(["RRULE:FREQ=DAILY;COUNT=5"]);
    expect(
      matchRecurrenceToStart(
        carried ?? [],
        { date: "2026-11-09" },
        "America/New_York",
        { dateTime: "2026-11-09T09:00:00-05:00" },
        {
          firstDay: Temporal.PlainDate.from("2026-11-09"),
          firstTime: Temporal.PlainTime.from("15:00"),
        }
      )
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=5"]);
    // Morning and afternoon as two rules: Nov 9 15:00 is the afternoon
    // rule's own meeting (five left), and the morning rule doesn't meet at
    // 15:00 (four left): nothing added.
    const twoRules = [
      "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=5",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
    ];
    expect(
      carryCountExactly(twoRules, {
        masterRecurrence: twoRules,
        originalStart: "2026-11-09T15:00:00-05:00",
        seriesStart: "2026-11-09T09:00:00-05:00",
        seriesZone: "America/New_York",
      })
    ).toEqual([
      "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=4",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
    ]);
  });

  test("splits two counted rules into exactly the series' meetings", () => {
    // A daily rule at `hour`, from `start`: its meetings at that hour from
    // the start on, the first `count` (a start at its hour is its first,
    // as the series' start counts only for a rule at its time).
    const zone = "America/New_York";
    const dailyAt = (hour: number, start: string, count: number) => {
      const from = Temporal.Instant.from(start);
      const day = from.toZonedDateTimeISO(zone).toPlainDate();
      const meetings: string[] = [];
      for (let offset = 0; meetings.length < count; offset += 1) {
        const at = day
          .add({ days: offset })
          .toZonedDateTime({ plainTime: { hour }, timeZone: zone })
          .toInstant();
        if (Temporal.Instant.compare(at, from) >= 0) {
          meetings.push(at.toString());
        }
      }
      return meetings;
    };
    const countOf = (line: string | undefined) =>
      Number(COUNT_VALUE.exec(line ?? "")?.[1]);
    const rules = [
      "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=5",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
    ];
    const seriesStart = "2026-11-09T09:00:00-05:00";
    const original = [
      ...dailyAt(9, seriesStart, 5),
      ...dailyAt(15, seriesStart, 5),
    ].sort();
    for (const split of [
      "2026-11-09T15:00:00-05:00",
      "2026-11-11T09:00:00-05:00",
      "2026-11-11T15:00:00-05:00",
    ]) {
      const carried = carryCountExactly(rules, {
        masterRecurrence: rules,
        originalStart: split,
        seriesStart,
        seriesZone: zone,
      });
      const splitAt = Temporal.Instant.from(split);
      const before = original.filter(
        (at) => Temporal.Instant.compare(Temporal.Instant.from(at), splitAt) < 0
      );
      const after = [
        ...dailyAt(9, split, countOf(carried?.[0])),
        ...dailyAt(15, split, countOf(carried?.[1])),
      ];
      expect([...before, ...after].sort()).toEqual(original);
    }
  });

  test("drops a spent rule wherever it is listed", () => {
    // 9:00 three times and 15:00 five times from Nov 9, split at Nov 11
    // 15:00: the 9:00 rule is spent (Nov 9-11), whichever comes first.
    const nine = "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=3";
    const fifteen = "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5";
    for (const rules of [
      [nine, fifteen],
      [fifteen, nine],
    ]) {
      expect(
        carryCountExactly(rules, {
          masterRecurrence: rules,
          originalStart: "2026-11-11T15:00:00-05:00",
          seriesStart: "2026-11-09T09:00:00-05:00",
          seriesZone: "America/New_York",
        })
      ).toEqual(["RRULE:FREQ=DAILY;BYHOUR=15;COUNT=3"]);
    }
  });

  test("ends a part whose rules are all spent at its start", () => {
    // Daily at the series' 9:00 and daily 15:00, three each from Nov 9,
    // split at an added Nov 20 15:00: both rules are spent, so the part is
    // just its start, in either order (no new 9:00 meeting on Nov 21).
    const clockless = "RRULE:FREQ=DAILY;COUNT=3";
    const fifteen = "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=3";
    const added = "RDATE;TZID=America/New_York:20261120T150000";
    for (const rules of [
      [clockless, fifteen],
      [fifteen, clockless],
    ]) {
      const master = [...rules, added];
      const split = "2026-11-20T15:00:00-05:00";
      const carried = carryCountExactly(master, {
        masterRecurrence: master,
        originalStart: split,
        seriesStart: "2026-11-09T09:00:00-05:00",
        seriesZone: "America/New_York",
      });
      const kept = carried?.filter((line) => line.startsWith("RRULE:")) ?? [];
      expect(kept).toHaveLength(1);
      expect(kept[0]).toContain("UNTIL=20261120T200000Z");
      expect(kept[0]).not.toContain("COUNT=");
    }
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

describe("isRuleDay", () => {
  const day = (iso: string) => Temporal.PlainDate.from(iso);
  test("reads the rule parts the editors write", () => {
    const start = day("2026-11-02");
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;BYDAY=MO,WE", start, day("2026-11-11"))
    ).toBe(true);
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;BYDAY=MO,WE", start, day("2026-11-10"))
    ).toBe(false);
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;INTERVAL=2", start, day("2026-11-09"))
    ).toBe(false);
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;INTERVAL=2", start, day("2026-11-16"))
    ).toBe(true);
    expect(
      isRuleDay("RRULE:FREQ=MONTHLY;BYDAY=-1FR", start, day("2026-11-27"))
    ).toBe(true);
    expect(
      isRuleDay("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1", start, day("2026-11-30"))
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
        start,
        day("2027-11-25")
      )
    ).toBe(true);
    // Every BY part narrows the set: Friday the 13th; a yearly day of the
    // month in every month; a weekly rule kept to the 1st.
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13",
        start,
        day("2027-08-13")
      )
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13",
        start,
        day("2026-12-13")
      )
    ).toBe(false);
    expect(
      isRuleDay("RRULE:FREQ=YEARLY;BYMONTHDAY=1", start, day("2027-02-01"))
    ).toBe(true);
    expect(
      isRuleDay("RRULE:FREQ=WEEKLY;BYMONTHDAY=1", start, day("2027-01-08"))
    ).toBe(false);
    // BYSETPOS: the 2nd Tuesday, and the last weekday.
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2",
        start,
        day("2026-12-08")
      )
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
        start,
        day("2026-11-30")
      )
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
        start,
        day("2026-11-27")
      )
    ).toBe(false);
    // Parts not read: can't tell.
    expect(
      isRuleDay("RRULE:FREQ=YEARLY;BYYEARDAY=100", start, day("2027-04-10"))
    ).toBeNull();
    // A list of times still meets on the rule's days: Google ignores the
    // list and meets once a day.
    expect(
      isRuleDay(
        "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15",
        start,
        day("2026-11-16")
      )
    ).toBe(true);
    expect(
      isRuleDay(
        "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15",
        start,
        day("2026-11-17")
      )
    ).toBe(false);
    // Google ignores a list of times, so BYSETPOS picks among days.
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=MO;BYHOUR=9,15;BYSETPOS=1",
        start,
        day("2026-12-07")
      )
    ).toBe(true);
  });
});

describe("hasAddedDays", () => {
  test("tells a series with added days", () => {
    expect(
      hasAddedDays(["RRULE:FREQ=WEEKLY", "RDATE;VALUE=DATE:20261103"])
    ).toBe(true);
    expect(
      hasAddedDays(["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261103"])
    ).toBe(false);
  });
});
