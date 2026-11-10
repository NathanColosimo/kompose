import { describe, expect, test } from "bun:test";
import {
  matchRecurrenceToStart,
  untilRuleForDay,
  untilRuleToDay,
} from "@kompose/google-cal/until";
import { Temporal } from "temporal-polyfill";

const day = (iso: string) => Temporal.PlainDate.from(iso);

describe("untilRuleForDay", () => {
  const zone = "America/New_York";
  test("ends after the picked day's occurrence, in the event's zone", () => {
    expect(untilRuleForDay(day("2026-12-05"), true, zone)).toBe("20261205");
    // The day's last second in New York, in UTC.
    expect(untilRuleForDay(day("2026-12-05"), false, zone)).toBe(
      "20261206T045959Z"
    );
    expect(untilRuleForDay(day("2027-03-14"), false, zone)).toBe(
      "20270315T035959Z"
    );
    expect(untilRuleForDay(day("2026-12-05"), false, "Asia/Tokyo")).toBe(
      "20261205T145959Z"
    );
  });

  test("reads back as the same day", () => {
    for (const allDay of [true, false]) {
      expect(
        untilRuleToDay(
          untilRuleForDay(day("2026-12-05"), allDay, zone),
          zone
        )?.toString()
      ).toBe("2026-12-05");
    }
  });
});

describe("matchRecurrenceToStart", () => {
  const zone = "America/New_York";
  const allDay = { date: "2026-11-07" };
  const timed = { dateTime: "2026-11-07T09:00:00-05:00" };

  test("gives an UNTIL the form its series' start takes", () => {
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z"],
        allDay,
        zone
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261205"]);
    expect(
      matchRecurrenceToStart(["RRULE:FREQ=WEEKLY;UNTIL=20261205"], timed, zone)
    ).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261206T045959Z"]);
    const same = ["RRULE:FREQ=WEEKLY;UNTIL=20261205"];
    expect(matchRecurrenceToStart(same, allDay, zone)).toBe(same);
  });

  test("ends an UNTIL on the series' last meeting's day", () => {
    // Mondays at 9:00 until the second before Nov 23's meeting, as a split
    // cuts: they meet Nov 9 and 16. Made all day, Nov 23 isn't added.
    const series = { dateTime: "2026-11-09T09:00:00-05:00" };
    const cut = ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261123T135959Z"];
    expect(
      matchRecurrenceToStart(cut, { date: "2026-11-09" }, zone, series)
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261122"]);
    // Moved to 8:00, Nov 23 at 8:00 would start before that UNTIL.
    expect(
      matchRecurrenceToStart(
        cut,
        { dateTime: "2026-11-09T08:00:00-05:00" },
        zone,
        series
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261123T045959Z"]);
    // Until Nov 23's own 9:00 start: moved to 10:00, Nov 23 still meets.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261123T140000Z"],
        { dateTime: "2026-11-09T10:00:00-05:00" },
        zone,
        series
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261124T045959Z"]);
  });

  test("ends each rule's UNTIL by that rule's own time", () => {
    // Mondays at the start's 9:00, and Tuesdays at 15:00 until noon Dec 1:
    // made all day, it ends Nov 30, so Tue Dec 1 isn't added.
    const [, tuesdays] = matchRecurrenceToStart(
      [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=15;UNTIL=20261201T170000Z",
      ],
      { date: "2026-11-09" },
      zone,
      { dateTime: "2026-11-09T09:00:00-05:00" }
    );
    expect(tuesdays).toContain("UNTIL=20261130");
  });

  test("keeps a date skip in a series that meets several times a day", () => {
    const rule = [
      "RRULE:FREQ=HOURLY;INTERVAL=6;UNTIL=20261205T045959Z",
      "EXDATE;VALUE=DATE:20261130",
    ];
    expect(
      matchRecurrenceToStart(
        rule,
        { dateTime: "2026-11-09T09:00:00-05:00" },
        zone,
        { dateTime: "2026-11-09T09:00:00-05:00" }
      )
    ).toContain("EXDATE;VALUE=DATE:20261130");
  });

  test("keeps a skipped occurrence skipped in the new form", () => {
    // Made all day: the skipped 9:00 (UTC 14:00) becomes its date.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY", "EXDATE:20261128T140000Z"],
        allDay,
        zone
      )
    ).toEqual(["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261128"]);
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY", "EXDATE;TZID=America/New_York:20261128T090000"],
        allDay,
        zone
      )
    ).toEqual(["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261128"]);
    // Made timed: the skipped date becomes that day at the series' time.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261128,20261205"],
        timed,
        zone
      )
    ).toEqual([
      "RRULE:FREQ=WEEKLY",
      "EXDATE:20261128T140000Z,20261205T140000Z",
    ]);
  });
});

describe("skipped occurrences on the series' days", () => {
  test("reads a skipped day in the series' zone, not its own", () => {
    // A Tokyo Monday 9:00 skipped as "Sunday 19:00 New York": still Monday.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=WEEKLY", "EXDATE;TZID=America/New_York:20261115T190000"],
        { date: "2026-11-09" },
        "Asia/Tokyo"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261116"]);
  });

  test("moves a skipped occurrence with the series' new time", () => {
    // 9:00 -> 10:00 New York: the skipped Nov 4 is at 10:00 now.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=DAILY", "EXDATE:20261104T140000Z"],
        { dateTime: "2026-11-01T10:00:00-05:00" },
        "America/New_York"
      )
    ).toEqual(["RRULE:FREQ=DAILY", "EXDATE:20261104T150000Z"]);
    // Unchanged time: left as written.
    const same = ["RRULE:FREQ=DAILY", "EXDATE:20261104T140000Z"];
    expect(
      matchRecurrenceToStart(
        same,
        { dateTime: "2026-11-01T09:00:00-05:00" },
        "America/New_York"
      )
    ).toBe(same);
  });

  test("lines skipped days up with the series' start, not an occurrence's", () => {
    // A client lined the skipped Nov 4 up with an occurrence moved to
    // 11:00; the series is at 9:00, so it's skipped at 9:00.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=DAILY", "EXDATE;TZID=America/New_York:20261104T110000"],
        { dateTime: "2026-11-01T09:00:00-05:00" },
        "America/New_York"
      )
    ).toEqual(["RRULE:FREQ=DAILY", "EXDATE:20261104T140000Z"]);
  });

  test("skips a deleted start an added day repeats at its new time too", () => {
    // Mondays 9:00 from Nov 9, its start also listed as an added day, and
    // skipped. Moved to 10:00, the added 9:00 stays skipped and so does
    // the start's meeting, now at 10:00.
    expect(
      matchRecurrenceToStart(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261109T090000",
          "EXDATE;TZID=America/New_York:20261109T090000",
        ],
        { dateTime: "2026-11-09T10:00:00-05:00" },
        "America/New_York",
        { dateTime: "2026-11-09T09:00:00-05:00" }
      ).at(-1)
    ).toBe("EXDATE:20261109T140000Z,20261109T150000Z");
  });

  test("keeps a skip in the repeated hour of a clock change at its own moment", () => {
    // Daily at 1:30 New York, with an added meeting at the second 1:30 of
    // Nov 1 (6:30 UTC, after clocks go back), skipped. The rule meets at
    // the first 1:30 (5:30 UTC), which stays.
    const recurrence = [
      "RRULE:FREQ=DAILY;INTERVAL=1",
      "RDATE:20261101T063000Z",
      "EXDATE:20261101T063000Z",
    ];
    const start = {
      dateTime: "2026-10-25T01:30:00-04:00",
      timeZone: "America/New_York",
    };
    expect(
      matchRecurrenceToStart(recurrence, start, "America/New_York", start)
    ).toEqual(recurrence);
    // Moved to 2:30, the skip stays where the added meeting is.
    expect(
      matchRecurrenceToStart(
        recurrence,
        { ...start, dateTime: "2026-10-25T02:30:00-04:00" },
        "America/New_York",
        start
      ).at(-1)
    ).toBe("EXDATE:20261101T063000Z");
  });

  test("skips such a meeting at its new time too when the rule can't be read", () => {
    // A week-number rule's days aren't read; Nov 30 9:00 may be its
    // meeting as well as an added one, so it stays skipped at 10:00 too.
    expect(
      matchRecurrenceToStart(
        [
          "RRULE:FREQ=YEARLY;BYDAY=MO;BYWEEKNO=48,49",
          "RDATE;TZID=America/New_York:20261130T090000",
          "EXDATE;TZID=America/New_York:20261130T090000",
        ],
        { dateTime: "2026-11-23T10:00:00-05:00" },
        "America/New_York",
        { dateTime: "2026-11-23T09:00:00-05:00" }
      ).at(-1)
    ).toBe("EXDATE:20261130T140000Z,20261130T150000Z");
  });

  test("keeps a skipped start off the rule's days when made all day", () => {
    // Mondays, but started on Sun Nov 8, which was skipped: made all day,
    // that skip becomes the date (the start is a meeting of its own).
    expect(
      matchRecurrenceToStart(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "EXDATE;TZID=America/New_York:20261108T090000",
        ],
        { date: "2026-11-08" },
        "America/New_York",
        { dateTime: "2026-11-08T09:00:00-05:00" }
      )
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20261108"]);
  });

  test("leaves a skipped time alone in a series with several a day", () => {
    // A rule at 9:00 and one at 15:00: the 15:00 skip is that rule's.
    const rules = [
      "RRULE:FREQ=DAILY;BYHOUR=9",
      "RRULE:FREQ=DAILY;BYHOUR=15",
      "EXDATE;TZID=America/New_York:20261104T150000",
    ];
    expect(
      matchRecurrenceToStart(
        rules,
        { dateTime: "2026-11-01T09:00:00-05:00" },
        "America/New_York"
      )
    ).toBe(rules);
  });

  test("reads a rule's list of times as Google does: once a day", () => {
    // Google ignores BYHOUR=9,15 and meets at the start's 9:00, so a skip
    // is on the start's time.
    expect(
      matchRecurrenceToStart(
        [
          "RRULE:FREQ=DAILY;BYHOUR=9,15",
          "EXDATE;TZID=America/New_York:20261104T150000",
        ],
        { dateTime: "2026-11-01T09:00:00-05:00" },
        "America/New_York"
      )
    ).toEqual(["RRULE:FREQ=DAILY;BYHOUR=9,15", "EXDATE:20261104T140000Z"]);
  });

  test("keeps the times of rules that meet at different hours", () => {
    // A 9:00 rule and a 15:00 one meet twice a day: neither is lined up
    // with the 9:00 start, and the skipped 15:00 stays 15:00.
    const rules = [
      "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=5",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
      "EXDATE;TZID=America/New_York:20261104T150000",
    ];
    expect(
      matchRecurrenceToStart(
        rules,
        { dateTime: "2026-11-02T09:00:00-05:00" },
        "America/New_York"
      )
    ).toBe(rules);
  });

  test("reads a rule's left-out time parts as the series' start's", () => {
    // Mondays BYHOUR=9 and Fridays BYHOUR=9;BYMINUTE=0 both meet at 9:00
    // for a 9:00 series: moved to 10:00, both rules and the skip move.
    expect(
      matchRecurrenceToStart(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
          "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=9;BYMINUTE=0",
          "EXDATE;TZID=America/New_York:20261113T090000",
        ],
        { dateTime: "2026-11-02T10:00:00-05:00" },
        "America/New_York",
        { dateTime: "2026-11-02T09:00:00-05:00" }
      )
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=10",
      "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=10;BYMINUTE=0",
      "EXDATE:20261113T150000Z",
    ]);
  });

  test("leaves a skipped added meeting's time alone", () => {
    // Mondays 9:00 plus an added Nov 16 15:00 that was then skipped: a
    // save (here, nothing changed) keeps that skip at 15:00, not 9:00.
    const kept = [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261116T150000",
      "EXDATE;TZID=America/New_York:20261116T150000",
    ];
    expect(
      matchRecurrenceToStart(
        kept,
        { dateTime: "2026-11-09T09:00:00-05:00" },
        "America/New_York",
        { dateTime: "2026-11-09T09:00:00-05:00" }
      )
    ).toBe(kept);
    // Moved to 10:00, a regular Nov 16 skip would land on the added 10:00
    // meeting and cancel it: it stays at 9:00.
    expect(
      matchRecurrenceToStart(
        [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261116T100000",
          "EXDATE;TZID=America/New_York:20261116T090000",
        ],
        { dateTime: "2026-11-09T10:00:00-05:00" },
        "America/New_York",
        { dateTime: "2026-11-09T09:00:00-05:00" }
      ).at(-1)
    ).toBe("EXDATE;TZID=America/New_York:20261116T090000");
  });

  test("moves a single BYHOUR with the series, and its skipped time", () => {
    // The rule's 9:00 is the series' time: moving it to 10:00 moves both.
    expect(
      matchRecurrenceToStart(
        ["RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "EXDATE:20261104T140000Z"],
        { dateTime: "2026-11-01T10:30:00-05:00" },
        "America/New_York"
      )
    ).toEqual([
      "RRULE:FREQ=DAILY;BYHOUR=10;BYMINUTE=30",
      "EXDATE:20261104T153000Z",
    ]);
  });
});
