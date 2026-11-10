import { describe, expect, test } from "bun:test";
import {
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

  test("an hourly rule's end is worked out", () => {
    // Every 4 hours ten times from Nov 1 9:00 ends Nov 2 21:00: deleting
    // from an added Nov 10 9:00 keeps it (no 50 meetings brought back).
    const hourly = "RRULE:FREQ=HOURLY;INTERVAL=4;COUNT=10";
    const added = "RDATE;TZID=America/New_York:20261110T090000";
    const from = "2026-11-01T09:00:00-04:00";
    expect(
      truncateRecurrenceForFollowing({
        originalStart: "2026-11-10T09:00:00-05:00",
        recurrence: [hourly, added],
        seriesStart: { dateTime: from },
        seriesZone: zone,
      })
    ).toEqual([hourly]);
  });

  test("a rule at another time counts the series' start, as RFC 5545 does", () => {
    // Daily 9:00 and daily 15:00, three each, from Nov 9 9:00: the series'
    // start is the 15:00 rule's first meeting too, then Nov 9 and 10 at
    // 15:00. Deleting from Nov 11 9:00 cuts the 9:00 rule; the 15:00 one
    // already ended, and keeps its COUNT.
    expect(
      truncateRecurrenceForFollowing({
        originalStart: "2026-11-11T09:00:00-05:00",
        recurrence: [
          "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=3",
          "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=3",
        ],
        seriesStart,
        seriesZone: zone,
      })
    ).toEqual([
      "RRULE:FREQ=DAILY;BYHOUR=9;UNTIL=20261111T135959Z",
      "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=3",
    ]);
  });

  test("a rule's count skips a time the clocks skip", () => {
    // Daily 2:30 three times from Fri Mar 12 2027: Sun Mar 14 has no 2:30,
    // so the meetings are Mar 12, 13 and 15. Deleting from an added Mar 14
    // 9:00 cuts the rule, so Mar 15 goes too.
    const [cut] = truncateRecurrenceForFollowing({
      originalStart: "2027-03-14T09:00:00-04:00",
      recurrence: [
        "RRULE:FREQ=DAILY;COUNT=3",
        "RDATE;TZID=America/New_York:20270314T090000",
      ],
      seriesStart: { dateTime: "2027-03-12T02:30:00-05:00" },
      seriesZone: zone,
    });
    expect(cut).toBe("RRULE:FREQ=DAILY;UNTIL=20270314T125959Z");
  });

  test("a cut always ends a rule that still runs past the split", () => {
    // Daily ten times (a list of times Google ignores: to Nov 18), and
    // every 4 hours ten times: cut at Nov 10 9:00, both end the second
    // before, whatever the rule.
    for (const rule of [
      "RRULE:FREQ=DAILY;BYHOUR=9,15;COUNT=10",
      "RRULE:FREQ=HOURLY;INTERVAL=4;COUNT=10",
    ]) {
      const [cut] = truncateRecurrenceForFollowing({
        originalStart: "2026-11-10T09:00:00-05:00",
        recurrence: [rule],
        seriesStart,
        seriesZone: zone,
      });
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
        truncateRecurrenceForFollowing({
          originalStart: "2026-11-20T09:00:00-05:00",
          recurrence: [rule, "RDATE;TZID=America/New_York:20261120T090000"],
          seriesStart,
          seriesZone: zone,
        })
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
        truncateRecurrenceForFollowing({
          originalStart: "2026-11-14T10:00:00-05:00",
          recurrence: [rule, "RDATE;TZID=America/New_York:20261114T100000"],
          seriesStart,
          seriesZone: zone,
        })
      ).toEqual([rule]);
    }
    // A rule still running is cut the second before the split.
    expect(
      truncateRecurrenceForFollowing({
        originalStart: "2026-11-12T09:00:00-05:00",
        recurrence: ["RRULE:FREQ=DAILY;COUNT=10"],
        seriesStart,
        seriesZone: zone,
      })
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

  test("deleting from an added meeting cuts each rule where it really ends", async () => {
    // Nov 9 every year twice (day 313; the series' Nov 9 2026 start is the
    // first), Mondays with no end, and an added Thu Nov 9 2028: deleting
    // from it cuts the Mondays and keeps the yearly COUNT, already spent.
    // Nothing else is read.
    const mixed: Event = {
      ...master,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RRULE:FREQ=YEARLY;BYYEARDAY=313;COUNT=2",
        "RDATE;TZID=America/New_York:20281109T090000",
      ],
    };
    const opened = occurrenceOf(mixed, "2028-11-09T09:00:00-05:00");
    const google = fakeGoogle(mixed, [opened]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.body?.recurrence)).toEqual([
      [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20281109T135959Z",
        "RRULE:FREQ=YEARLY;BYYEARDAY=313;COUNT=2",
      ],
    ]);
    expect(
      google.requests.some((request) =>
        request.url.pathname.endsWith("/instances")
      )
    ).toBe(false);
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

describe("deleting This and following beside a rule whose end can't be told", () => {
  test("keeps that rule's COUNT, so the cut adds no meetings", async () => {
    // Mondays, plus ten meetings on the hour from Nov 9 (a BYMINUTE list
    // isn't read): deleting from Mon Nov 16 cuts the Mondays. An UNTIL on
    // the other rule would run it every hour until Nov 16.
    const mixed: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10",
      ],
    };
    const opened = occurrenceOf(mixed, "2026-11-16T09:00:00-05:00");
    const google = fakeGoogle(mixed, [opened]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T135959Z",
      "RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10",
    ]);
  });
});
