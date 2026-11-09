/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  followingDelete,
  followingSplitBlocked,
  truncateRecurrenceForFollowing,
} from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import { Exit } from "effect";
import {
  edit,
  fakeGoogle,
  nov16,
  occurrenceOf,
  refusalOf,
  run,
  service,
  weekly,
  zone,
} from "./google-test-fixtures";

const seriesStart = { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone };

describe("where This and following can start", () => {
  const blocked = (recurrence: string[], originalStart: string) =>
    followingSplitBlocked({
      masterRecurrence: recurrence,
      masterStart: seriesStart,
      originalStart,
      seriesZone: zone,
    });

  test("not at an added meeting after the rule has ended", () => {
    // Daily 9:00 five times (Nov 9-13), or until Nov 13, plus an added
    // Nov 20 9:00: a weekday and time the rule has, but past its end.
    for (const rule of [
      "RRULE:FREQ=DAILY;COUNT=5",
      "RRULE:FREQ=DAILY;UNTIL=20261114T045959Z",
    ]) {
      expect(
        blocked(
          [rule, "RDATE;TZID=America/New_York:20261120T090000"],
          "2026-11-20T09:00:00-05:00"
        )
      ).toBe("addedOccurrence");
      // One of the rule's own meetings still can.
      expect(blocked([rule], "2026-11-12T09:00:00-05:00")).toBeNull();
    }
  });

  test("not in a series with an exclusion rule", () => {
    // A new start would re-anchor the EXRULE's phase (which Sundays it
    // skips), so it counts as a second rule.
    expect(
      blocked(
        ["RRULE:FREQ=DAILY", "EXRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU"],
        "2026-11-16T09:00:00-05:00"
      )
    ).toBe("severalRules");
  });

  test("counts a series' first start even off the rule's days", () => {
    // Mondays three times, but starting Wed Nov 4: the meetings are Nov 4,
    // 9 and 16, so an added Nov 23 is past the end, not a rule meeting.
    expect(
      followingSplitBlocked({
        masterRecurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
          "RDATE;TZID=America/New_York:20261123T090000",
        ],
        masterStart: { dateTime: "2026-11-04T09:00:00-05:00" },
        originalStart: "2026-11-23T09:00:00-05:00",
        seriesZone: zone,
      })
    ).toBe("addedOccurrence");
  });

  test("not at an added meeting after the rule's end that same day", () => {
    // Daily 9:00 until Nov 13 at 8:00 (13:00Z): an added Nov 13 9:00 is
    // after the rule's end, by the minute.
    expect(
      blocked(
        [
          "RRULE:FREQ=DAILY;UNTIL=20261113T130000Z",
          "RDATE;TZID=America/New_York:20261113T090000",
        ],
        "2026-11-13T09:00:00-05:00"
      )
    ).toBe("addedOccurrence");
  });

  test("an hourly rule's end is worked out, and an unknown one read from Google's list", () => {
    // Every 4 hours ten times from Nov 1 9:00 ends Nov 2 21:00: deleting
    // from an added Nov 10 9:00 keeps it (no 50 meetings brought back).
    const hourly = "RRULE:FREQ=HOURLY;INTERVAL=4;COUNT=10";
    const added = "RDATE;TZID=America/New_York:20261110T090000";
    const from = "2026-11-01T09:00:00-04:00";
    expect(
      truncateRecurrenceForFollowing(
        [hourly, added],
        "2026-11-10T09:00:00-05:00",
        zone,
        from
      )
    ).toEqual([hourly]);
    const unsure = (rule: string) =>
      followingDelete({
        masterRecurrence: [rule, added],
        masterStart: { dateTime: from },
        originalStart: "2026-11-10T09:00:00-05:00",
        seriesZone: zone,
      });
    expect(unsure(hourly)).toBe("cut");
    // On the hour and half hour: its end isn't worked out, so a delete
    // from the added meeting reads it from Google's list, not a guess.
    expect(unsure("RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10")).toBe("list");
    // Every hour from Oct 31, across the Nov 1 clock change: can't tell
    // which hour it ends, so from the list too.
    expect(
      followingDelete({
        masterRecurrence: ["RRULE:FREQ=HOURLY;COUNT=400", added],
        masterStart: { dateTime: "2026-10-31T09:00:00-04:00" },
        originalStart: "2026-11-10T09:00:00-05:00",
        seriesZone: zone,
      })
    ).toBe("list");
  });

  test("a rule at another time doesn't count the series' start", () => {
    // Daily 9:00 and daily 15:00, three each, from Nov 9 9:00: the 15:00
    // rule meets Nov 9, 10, 11 at 15:00. Deleting from Nov 11 9:00 cuts it
    // too, so its Nov 11 15:00 goes.
    expect(
      truncateRecurrenceForFollowing(
        [
          "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=3",
          "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=3",
        ],
        "2026-11-11T09:00:00-05:00",
        zone,
        seriesStart.dateTime
      )
    ).toEqual([
      "RRULE:FREQ=DAILY;BYHOUR=9;UNTIL=20261111T135959Z",
      "RRULE:FREQ=DAILY;BYHOUR=15;UNTIL=20261111T135959Z",
    ]);
  });

  test("a rule's count skips a time the clocks skip", () => {
    // Daily 2:30 three times from Fri Mar 12 2027: Sun Mar 14 has no 2:30,
    // so the meetings are Mar 12, 13 and 15. Deleting from an added Mar 14
    // 9:00 cuts the rule, so Mar 15 goes too.
    const [cut] = truncateRecurrenceForFollowing(
      [
        "RRULE:FREQ=DAILY;COUNT=3",
        "RDATE;TZID=America/New_York:20270314T090000",
      ],
      "2027-03-14T09:00:00-04:00",
      zone,
      "2027-03-12T02:30:00-05:00"
    );
    expect(cut).toBe("RRULE:FREQ=DAILY;UNTIL=20270314T125959Z");
  });

  test("an hourly rule across either clock change is read from Google's list, not guessed", () => {
    // Every 2 hours four times from Oct 31 23:30 (fall back) or Mar 13
    // 23:30 (spring forward), each with an added meeting at 5:00 the next
    // morning: which wall hour the last lands on depends on how a calendar
    // steps across the change, so a delete from the added meeting reads
    // its end from Google's list.
    // A year of hourly meetings, Nov 2 2026 to Nov 10 2027, both ends in
    // standard time: it crosses both changes, which cancel out at its ends
    // (an offset check would call it known, ending 9:00 before the added
    // 9:30). From the list too.
    expect(
      followingDelete({
        masterRecurrence: [
          "RRULE:FREQ=HOURLY;COUNT=8953",
          "RDATE;TZID=America/New_York:20271110T093000",
        ],
        masterStart: { dateTime: "2026-11-02T09:00:00-05:00" },
        originalStart: "2027-11-10T09:30:00-05:00",
        seriesZone: zone,
      })
    ).toBe("list");
    const cases: [string, string, string][] = [
      [
        "2026-10-31T23:30:00-04:00",
        "20261101T050000",
        "2026-11-01T05:00:00-05:00",
      ],
      [
        "2027-03-13T23:30:00-05:00",
        "20270314T050000",
        "2027-03-14T05:00:00-04:00",
      ],
    ];
    for (const [start, added, originalStart] of cases) {
      expect(
        followingDelete({
          masterRecurrence: [
            "RRULE:FREQ=HOURLY;INTERVAL=2;COUNT=4",
            `RDATE;TZID=America/New_York:${added}`,
          ],
          masterStart: { dateTime: start },
          originalStart,
          seriesZone: zone,
        })
      ).toBe("list");
    }
  });

  test("a cut always ends a rule that still runs past the split", () => {
    // Daily ten times (a list of times Google ignores: to Nov 18), and
    // every 4 hours ten times: cut at Nov 10 9:00, both end the second
    // before, whatever the rule.
    for (const rule of [
      "RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=10",
      "RRULE:FREQ=HOURLY;INTERVAL=4;COUNT=10",
    ]) {
      const [cut] = truncateRecurrenceForFollowing(
        [rule],
        "2026-11-10T09:00:00-05:00",
        zone,
        seriesStart.dateTime
      );
      expect(cut).toContain("UNTIL=20261110T135959Z");
      expect(cut).not.toContain("COUNT=");
    }
  });

  test("a cut never lengthens a rule that already ended", () => {
    // Deleting from that Nov 20 meeting on keeps the rule's own end.
    for (const rule of [
      "RRULE:FREQ=DAILY;COUNT=5",
      "RRULE:FREQ=DAILY;UNTIL=20261114T045959Z",
    ]) {
      expect(
        truncateRecurrenceForFollowing(
          [rule, "RDATE;TZID=America/New_York:20261120T090000"],
          "2026-11-20T09:00:00-05:00",
          zone,
          seriesStart.dateTime
        )
      ).toEqual([rule]);
    }
    // Deleting from an added Nov 14 10:00, the day after the rule's last
    // (COUNT, or UNTIL that night, or UNTIL mid-morning Nov 14): the rule
    // keeps its end, and no Nov 14 9:00 meeting appears.
    for (const rule of [
      "RRULE:FREQ=DAILY;COUNT=5",
      "RRULE:FREQ=DAILY;UNTIL=20261114T045959Z",
      "RRULE:FREQ=DAILY;UNTIL=20261114T143000Z",
    ]) {
      expect(
        truncateRecurrenceForFollowing(
          [rule, "RDATE;TZID=America/New_York:20261114T100000"],
          "2026-11-14T10:00:00-05:00",
          zone,
          seriesStart.dateTime
        )
      ).toEqual([rule]);
    }
    // A rule still running is cut the second before the split.
    expect(
      truncateRecurrenceForFollowing(
        ["RRULE:FREQ=DAILY;COUNT=10"],
        "2026-11-12T09:00:00-05:00",
        zone,
        seriesStart.dateTime
      )
    ).toEqual(["RRULE:FREQ=DAILY;UNTIL=20261112T135959Z"]);
  });
});

describe("This and following from an added meeting, or with several rules", () => {
  const master: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=4",
      "RDATE;TZID=America/New_York:20261116T090000",
    ],
  };
  // The added off-week Monday.
  const added = occurrenceOf(master, "2026-11-16T09:00:00-05:00");

  test("when saving from an added meeting", async () => {
    const google = fakeGoogle(master, [added]);
    expect(
      await refusalOf(edit("following", added, { summary: "Planning (moved)" }))
    ).toMatchObject({ data: { reason: "addedOccurrence" } });
    expect(google.writes()).toEqual([]);
  });

  test("deleting from an added meeting reads a rule's end it can't tell from Google's list", async () => {
    const unsure: Event = {
      ...master,
      recurrence: [
        "RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10",
        "RDATE;TZID=America/New_York:20261116T090000",
      ],
    };
    const opened = occurrenceOf(unsure, "2026-11-16T09:00:00-05:00");
    // Google's list: the rule's meetings (on Nov 9, or also on Nov 17),
    // and the added Nov 16.
    const deleteWith = async (listed: string[]) => {
      const google = fakeGoogle(unsure, [opened], (request) =>
        request.url.pathname.endsWith("/instances")
          ? {
              items: listed.map((dateTime) => ({
                originalStartTime: { dateTime, timeZone: zone },
              })),
            }
          : undefined
      );
      expect(
        Exit.isSuccess(
          await run(service().deleteEvent("primary", opened.id, "following"))
        )
      ).toBe(true);
      return google.writes().map((write) => write.body?.recurrence);
    };
    // The rule ended on Nov 9: it keeps its COUNT (cut, it would run on to
    // Nov 16), and Nov 16 goes.
    expect(
      await deleteWith([
        "2026-11-09T09:00:00-05:00",
        "2026-11-09T09:30:00-05:00",
        "2026-11-16T09:00:00-05:00",
      ])
    ).toEqual([
      ["RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10", "EXDATE:20261116T140000Z"],
    ]);
    // A rule meeting Google lists after the split: the rule is cut there.
    expect(
      await deleteWith([
        "2026-11-09T09:00:00-05:00",
        "2026-11-16T09:00:00-05:00",
        "2026-11-17T09:00:00-05:00",
      ])
    ).toEqual([["RRULE:FREQ=HOURLY;BYMINUTE=0,30;UNTIL=20261116T135959Z"]]);
  });

  test("deleting from an added meeting keeps a rule whose end it can't tell, beside rules it can", async () => {
    // Nov 9 every year, twice (a day-of-year rule isn't read here), and
    // Mondays to Nov 27 2028, plus an added Thu Nov 9 2028: deleting from
    // it keeps the yearly COUNT (cut, it would meet again on Nov 8 2028,
    // day 313 of a leap year), cuts the Mondays, and skips each meeting
    // Google lists from then.
    const mixed: Event = {
      ...master,
      recurrence: [
        "RRULE:FREQ=YEARLY;BYYEARDAY=313;COUNT=2",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20281128T045959Z",
        "RDATE;TZID=America/New_York:20281109T090000",
      ],
    };
    const opened = occurrenceOf(mixed, "2028-11-09T09:00:00-05:00");
    const listed = [
      "2027-11-09T09:00:00-05:00",
      "2028-11-06T09:00:00-05:00",
      "2028-11-09T09:00:00-05:00",
      "2028-11-13T09:00:00-05:00",
      "2028-11-20T09:00:00-05:00",
      "2028-11-27T09:00:00-05:00",
    ];
    const google = fakeGoogle(mixed, [opened], (request) =>
      request.url.pathname.endsWith("/instances")
        ? {
            items: listed.map((dateTime) => ({
              originalStartTime: { dateTime, timeZone: zone },
            })),
          }
        : undefined
    );
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.body?.recurrence)).toEqual([
      [
        "RRULE:FREQ=YEARLY;BYYEARDAY=313;COUNT=2",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20281109T135959Z",
        "EXDATE:20281109T140000Z,20281113T140000Z,20281120T140000Z,20281127T140000Z",
      ],
    ]);
  });

  test("deleting from one rule's meeting keeps another rule whose end it can't tell", async () => {
    // As above, deleting from Mon Nov 13 2028, a meeting of the Mondays
    // rule: cut, the yearly rule would meet on Nov 8 2028.
    const mixed: Event = {
      ...master,
      recurrence: [
        "RRULE:FREQ=YEARLY;BYYEARDAY=313;COUNT=2",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20281128T045959Z",
      ],
    };
    const opened = occurrenceOf(mixed, "2028-11-13T09:00:00-05:00");
    const listed = [
      "2027-11-09T09:00:00-05:00",
      "2028-11-06T09:00:00-05:00",
      "2028-11-13T09:00:00-05:00",
      "2028-11-20T09:00:00-05:00",
      "2028-11-27T09:00:00-05:00",
    ];
    const google = fakeGoogle(mixed, [opened], (request) =>
      request.url.pathname.endsWith("/instances")
        ? {
            items: listed.map((dateTime) => ({
              originalStartTime: { dateTime, timeZone: zone },
            })),
          }
        : undefined
    );
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.body?.recurrence)).toEqual([
      [
        "RRULE:FREQ=YEARLY;BYYEARDAY=313;COUNT=2",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20281113T135959Z",
        "EXDATE:20281113T140000Z,20281120T140000Z,20281127T140000Z",
      ],
    ]);
  });

  test("deleting from one rule's meeting skips only what the unsure rule can meet", async () => {
    // Nov 9 every year a hundred times from 1950 (too long to walk to its
    // end) and Mondays to Nov 27 2028, deleted from Mon Nov 13 2028: the
    // Mondays end with their cut, so only Nov 9 2029 needs a skip.
    const long: Event = {
      ...master,
      end: { dateTime: "1950-11-09T09:30:00-05:00", timeZone: zone },
      recurrence: [
        "RRULE:FREQ=YEARLY;COUNT=100",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20281128T045959Z",
      ],
      start: { dateTime: "1950-11-09T09:00:00-05:00", timeZone: zone },
    };
    const opened = occurrenceOf(long, "2028-11-13T09:00:00-05:00");
    const listed = [
      "2028-11-13T09:00:00-05:00",
      "2028-11-20T09:00:00-05:00",
      "2029-11-09T09:00:00-05:00",
    ];
    const google = fakeGoogle(long, [opened], (request) =>
      request.url.pathname.endsWith("/instances")
        ? {
            items: listed.map((dateTime) => ({
              originalStartTime: { dateTime, timeZone: zone },
            })),
          }
        : undefined
    );
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.body?.recurrence)).toEqual([
      [
        "RRULE:FREQ=YEARLY;COUNT=100",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20281113T135959Z",
        "EXDATE:20291109T140000Z",
      ],
    ]);
  });

  test("deleting beside a rule within the day skips every listed meeting it may hold", async () => {
    // On the hour and half hour ten times (an end it can't tell) and daily
    // at 10:00 three times, from Nov 1 9:00, deleted from 10:00: the hourly
    // rule may hold any listed meeting from then.
    const hourly: Event = {
      ...master,
      end: { dateTime: "2026-11-01T09:30:00-05:00", timeZone: zone },
      recurrence: [
        "RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10",
        "RRULE:FREQ=DAILY;BYHOUR=10;COUNT=3",
      ],
      start: { dateTime: "2026-11-01T09:00:00-05:00", timeZone: zone },
    };
    const opened = occurrenceOf(hourly, "2026-11-01T10:00:00-05:00");
    const listed = [
      "2026-11-01T09:00:00-05:00",
      "2026-11-01T09:30:00-05:00",
      "2026-11-01T10:00:00-05:00",
      "2026-11-01T10:30:00-05:00",
      "2026-11-01T11:00:00-05:00",
    ];
    const google = fakeGoogle(hourly, [opened], (request) =>
      request.url.pathname.endsWith("/instances")
        ? {
            items: listed.map((dateTime) => ({
              originalStartTime: { dateTime, timeZone: zone },
            })),
          }
        : undefined
    );
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.body?.recurrence)).toEqual([
      [
        "RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10",
        "RRULE:FREQ=DAILY;BYHOUR=10;UNTIL=20261101T145959Z",
        "EXDATE:20261101T150000Z,20261101T153000Z,20261101T160000Z",
      ],
    ]);
  });

  test("deleting from an added meeting at another hour of a rule within the day skips it too", async () => {
    // On the hour and half hour ten times from Nov 1 9:00, plus an added
    // 18:00: deleting from 18:00 drops the added day and skips 18:00 in
    // case the rule meets then as well.
    const hourly: Event = {
      ...master,
      end: { dateTime: "2026-11-01T09:30:00-05:00", timeZone: zone },
      recurrence: [
        "RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10",
        "RDATE;TZID=America/New_York:20261101T180000",
      ],
      start: { dateTime: "2026-11-01T09:00:00-05:00", timeZone: zone },
    };
    const opened = occurrenceOf(hourly, "2026-11-01T18:00:00-05:00");
    const google = fakeGoogle(hourly, [opened], (request) =>
      request.url.pathname.endsWith("/instances")
        ? {
            items: [
              "2026-11-01T09:00:00-05:00",
              "2026-11-01T13:30:00-05:00",
              "2026-11-01T18:00:00-05:00",
            ].map((dateTime) => ({
              originalStartTime: { dateTime, timeZone: zone },
            })),
          }
        : undefined
    );
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.body?.recurrence)).toEqual([
      ["RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10", "EXDATE:20261101T230000Z"],
    ]);
  });

  test("deleting from an added meeting is refused when another rule never ends", async () => {
    // Google's list of a series that never ends doesn't end either.
    const endless: Event = {
      ...master,
      recurrence: [
        "RRULE:FREQ=YEARLY;BYYEARDAY=313;COUNT=2",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20281109T090000",
      ],
    };
    const opened = occurrenceOf(endless, "2028-11-09T09:00:00-05:00");
    const google = fakeGoogle(endless, [opened]);
    expect(
      await refusalOf(service().deleteEvent("primary", opened.id, "following"))
    ).toMatchObject({ data: { reason: "deleteFromAddedOccurrence" } });
    expect(google.writes()).toEqual([]);
  });

  test("when moving it to another calendar from there", async () => {
    const google = fakeGoogle(master, [added]);
    expect(
      await refusalOf(
        service().moveEvent("primary", added.id, "work", "following")
      )
    ).toMatchObject({ data: { reason: "addedOccurrence" } });
    expect(google.writes()).toEqual([]);
  });

  test.each([
    ["with an offset", "2026-11-23T09:00:00-05:00"],
    ["without an offset, in its zone", "2026-11-23T09:00:00"],
  ])(
    "when the new series' repeat ends before its first meeting (start %s)",
    async (_form, start) => {
      // Nov 16 moved to the 23rd, its repeat ending on the 16th.
      const google = fakeGoogle(weekly, [nov16]);
      expect(
        await refusalOf(
          edit("following", nov16, {
            end: { dateTime: start.replace("09:00", "09:30"), timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261117T045959Z"],
            start: { dateTime: start, timeZone: zone },
          })
        )
      ).toMatchObject({ data: { reason: "endsBeforeStart" } });
      expect(google.writes()).toEqual([]);
    }
  );
});
