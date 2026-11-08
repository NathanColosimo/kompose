import { describe, expect, test } from "bun:test";
import {
  carryCount,
  carryCountExactly,
  splitAddedDays,
  truncateRecurrenceForFollowing,
  withRemainingCount,
} from "@kompose/google-cal/recurrence-utils";
import { isRuleDay } from "@kompose/google-cal/rule-days";
import { matchRecurrenceToStart } from "@kompose/google-cal/until";
import { Temporal } from "temporal-polyfill";

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
        newStart: "2026-11-03",
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
        newStart: "2026-11-03",
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
        newStart: "2026-11-03",
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
        newStart: nyDaily(3),
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
        newStart: "2026-11-03T14:00:00.000Z",
        originalStart: "2026-11-03T14:00:00.000Z",
        seriesStart: "2026-11-01T14:00:00.000Z",
        seriesZone: "America/New_York",
        starts: [1, 2, 3, 4, 5].map((day) => `2026-11-0${day}T14:00:00.000Z`),
      })
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
  });

  test("ends a moved new part after its last day, at any time that day", () => {
    // A rule not walked here (several times a day) with an added day, moved from 9:00 to
    // 10:00 and a day later: the old rule's last day (Nov 5) becomes Nov 6,
    // through its last second.
    expect(
      carryCount(["RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=5"], {
        masterRecurrence: [
          "RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=5",
          "RDATE;TZID=America/New_York:20261120T090000",
        ],
        newStart: nyDaily(4, 10),
        originalStart: nyDaily(3),
        seriesStart: nyDaily(1),
        seriesZone: "America/New_York",
        starts: [1, 2, 3, 4, 5, 20].map((day) => nyDaily(day)),
      })
    ).toEqual(["RRULE:FREQ=DAILY;BYHOUR=9,15;UNTIL=20261107T045959Z"]);
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
        newStart: "2026-11-04",
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
        newStart: "2026-11-04",
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
        newStart: "2026-11-03",
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
        newStart: "2026-11-09",
        originalStart: "2026-11-09",
        seriesStart: "2026-11-01",
        seriesZone: "America/New_York",
        starts: ["2026-11-01", "2026-11-02", "2026-11-09"],
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"]);
  });

  test("carries Sol's Mondays exactly, with an added day on a rule day", () => {
    // Mondays Nov 2, 9, 16 (COUNT=3) plus added Nov 3 and Nov 16, split at
    // Nov 9 and moved to Tuesdays: two left (Nov 10, 17).
    expect(
      carryCount(["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=3"], {
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
          "RDATE;VALUE=DATE:20261103,20261116",
        ],
        newStart: "2026-11-10",
        originalStart: "2026-11-09",
        seriesStart: "2026-11-02",
        seriesZone: "America/New_York",
        starts: ["2026-11-02", "2026-11-03", "2026-11-09", "2026-11-16"],
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2"]);
  });
  test("walks the first-Monday rule Sol found miscounted", () => {
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

  test("walks a single-hour rule with added days, as Sol's Mondays", () => {
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
    // Split at Dec 7 (the daily rule's own count is spent): the second
    // rule has one Monday left; split past its last, it's dropped.
    expect(split("2026-12-07")).toEqual([
      "RRULE:FREQ=DAILY;COUNT=1",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1",
    ]);
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
    // 15:00 one Nov 9 (the series' start), Nov 10 (three left).
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
    // Split Tue Nov 17 at 15:00: two Mondays and one Tuesday used.
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
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2",
      "RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=15;COUNT=2",
    ]);
  });

  test("carries a several-a-day COUNT made all day into days", () => {
    // 9:00 and 15:00, ten meetings from Mon Nov 9 (Nov 9-13); "This and
    // following" from Nov 11 9:00, made all day: six meetings left, three
    // days, once the server lines the rule up with the new series' start.
    const rule = ["RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=10"];
    const starts = ["09", "10", "11", "12", "13"].flatMap((day) => [
      `2026-11-${day}T09:00:00-05:00`,
      `2026-11-${day}T15:00:00-05:00`,
    ]);
    const carried = carryCount(rule, {
      masterRecurrence: rule,
      newStart: "2026-11-11",
      originalStart: "2026-11-11T09:00:00-05:00",
      seriesStart: "2026-11-09T09:00:00-05:00",
      seriesZone: "America/New_York",
      starts,
    });
    expect(
      matchRecurrenceToStart(
        carried,
        { date: "2026-11-11" },
        "America/New_York",
        {
          dateTime: "2026-11-09T09:00:00-05:00",
        }
      )
    ).toEqual(["RRULE:FREQ=DAILY;COUNT=3"]);
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
    // Several times a day still meet on the rule's days, unless BYSETPOS
    // picks among those times.
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
    expect(
      isRuleDay(
        "RRULE:FREQ=MONTHLY;BYDAY=MO;BYHOUR=9,15;BYSETPOS=1",
        start,
        day("2026-12-07")
      )
    ).toBeNull();
  });
});
