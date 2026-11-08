import { afterEach, describe, expect, test } from "bun:test";
import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import {
  followingCutUnsure,
  followingSplitBlocked,
  truncateRecurrenceForFollowing,
} from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import { Effect, Exit } from "effect";

const zone = "America/New_York";
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

  test("an hourly rule's end is worked out, and an unknown one refused", () => {
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
      followingCutUnsure({
        masterRecurrence: [rule, added],
        masterStart: { dateTime: from },
        originalStart: "2026-11-10T09:00:00-05:00",
        seriesZone: zone,
      });
    expect(unsure(hourly)).toBe(false);
    // On the hour and half hour: its end isn't worked out, so a delete
    // from the added meeting is refused rather than guessed.
    expect(unsure("RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10")).toBe(true);
    // Every hour from Oct 31, across the Nov 1 clock change: can't tell
    // which hour it ends, so unsure too.
    expect(
      followingCutUnsure({
        masterRecurrence: ["RRULE:FREQ=HOURLY;COUNT=400", added],
        masterStart: { dateTime: "2026-10-31T09:00:00-04:00" },
        originalStart: "2026-11-10T09:00:00-05:00",
        seriesZone: zone,
      })
    ).toBe(true);
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

  test("an hourly rule across either clock change is refused, not guessed", () => {
    // Every 2 hours four times from Oct 31 23:30 (fall back) or Mar 13
    // 23:30 (spring forward), each with an added meeting at 5:00 the next
    // morning: which wall hour the last lands on depends on how a calendar
    // steps across the change, so a delete from the added meeting is off.
    // A year of hourly meetings, Nov 2 2026 to Nov 10 2027, both ends in
    // standard time: it crosses both changes, which cancel out at its ends
    // (an offset check would call it known, ending 9:00 before the added
    // 9:30). Still unsure.
    expect(
      followingCutUnsure({
        masterRecurrence: [
          "RRULE:FREQ=HOURLY;COUNT=8953",
          "RDATE;TZID=America/New_York:20271110T093000",
        ],
        masterStart: { dateTime: "2026-11-02T09:00:00-05:00" },
        originalStart: "2027-11-10T09:30:00-05:00",
        seriesZone: zone,
      })
    ).toBe(true);
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
        followingCutUnsure({
          masterRecurrence: [
            "RRULE:FREQ=HOURLY;INTERVAL=2;COUNT=4",
            `RDATE;TZID=America/New_York:${added}`,
          ],
          masterStart: { dateTime: start },
          originalStart,
          seriesZone: zone,
        })
      ).toBe(true);
    }
  });

  test("a cut always ends a rule that still runs past the split", () => {
    // Twice a day ten times (to Nov 13), and every 4 hours ten times:
    // cut at Nov 10 9:00, both end the second before, whatever the rule.
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

describe("the server refuses a split that can't start a series", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * Google answers each request with `answer(url)`; every request is
   * recorded. (The client takes fetch when it's made: stub it first.)
   */
  const stubGoogle = (answer: (url: string) => Event) => {
    const requests: string[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push(`${method} ${String(input)}`);
      return Promise.resolve(
        new Response(JSON.stringify(answer(String(input))), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
      );
    }) as typeof fetch;
    return requests;
  };

  const master: Event = {
    end: { dateTime: "2026-11-09T09:30:00-05:00", timeZone: zone },
    id: "series",
    recurrence: [
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=4",
      "RDATE;TZID=America/New_York:20261116T090000",
    ],
    start: seriesStart,
    summary: "Planning",
  } as Event;
  // The added off-week Monday.
  const added: Event = {
    ...master,
    id: "series_20261116T140000Z",
    originalStartTime: {
      dateTime: "2026-11-16T09:00:00-05:00",
      timeZone: zone,
    },
    recurrence: undefined,
    recurringEventId: "series",
    start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
    end: { dateTime: "2026-11-16T09:30:00-05:00", timeZone: zone },
  } as Event;

  const failsBeforeWriting = async (
    run: Effect.Effect<unknown, unknown>,
    requests: string[]
  ) => {
    const exit = await Effect.runPromiseExit(run);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain(
      "This and following isn't available"
    );
    expect(requests.filter((r) => !r.startsWith("GET"))).toEqual([]);
  };

  test("when saving from an added meeting", async () => {
    const requests = stubGoogle(() => master);
    const service = makeGoogleCalendarService("token");
    await failsBeforeWriting(
      service.updateEvent(
        "primary",
        added.id,
        { ...added, summary: "Planning (moved)" },
        "following",
        added
      ),
      requests
    );
  });

  test("when deleting from an added meeting a rule's end can't be told", async () => {
    const unsureMaster = {
      ...master,
      recurrence: [
        "RRULE:FREQ=HOURLY;BYMINUTE=0,30;COUNT=10",
        "RDATE;TZID=America/New_York:20261116T090000",
      ],
    } as Event;
    const requests = stubGoogle((url) =>
      url.includes(added.id) ? added : unsureMaster
    );
    const service = makeGoogleCalendarService("token");
    const error = await Effect.runPromise(
      Effect.flip(service.deleteEvent("primary", added.id, "following"))
    );
    // A refusal the user can read, not "Try again".
    expect("publicError" in error && error.publicError).toEqual({
      code: "BAD_REQUEST",
      message:
        "Deleting this and following isn't available from an occurrence added to this series.",
    });
    expect(requests.filter((r) => !r.startsWith("GET"))).toEqual([]);
  });

  test("when moving it to another calendar from there", async () => {
    // The instance first, then its series' master.
    const requests = stubGoogle((url) =>
      url.includes(added.id) ? added : master
    );
    const service = makeGoogleCalendarService("token");
    await failsBeforeWriting(
      service.moveEvent("primary", added.id, "work", "following"),
      requests
    );
  });

  // A weekly series' Monday Nov 16 meeting, edited to start Nov 23.
  const weekly = {
    ...master,
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
  } as Event;
  const monday = {
    ...weekly,
    end: { dateTime: "2026-11-16T09:30:00-05:00", timeZone: zone },
    id: "series_20261116T140000Z",
    originalStartTime: {
      dateTime: "2026-11-16T09:00:00-05:00",
      timeZone: zone,
    },
    recurrence: undefined,
    recurringEventId: "series",
    start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
  } as Event;
  const moveFollowing = (start: string, recurrence: string[]) => {
    const requests = stubGoogle((url) =>
      url.includes(monday.id) ? monday : weekly
    );
    const run = makeGoogleCalendarService("token").updateEvent(
      "primary",
      monday.id,
      {
        ...monday,
        end: { dateTime: start.replace("09:00", "09:30"), timeZone: zone },
        recurrence,
        start: { dateTime: start, timeZone: zone },
      },
      "following",
      monday
    );
    return { requests, run };
  };

  test.each([
    ["with an offset", "2026-11-23T09:00:00-05:00"],
    ["without an offset, in its zone", "2026-11-23T09:00:00"],
  ])(
    "when the new series' repeat ends before its first meeting (start %s)",
    async (_form, start) => {
      // Ends on the 16th, then moved to the 23rd.
      const { requests, run } = moveFollowing(start, [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261117T045959Z",
      ]);
      const exit = await Effect.runPromiseExit(run);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain(
        "The repeat ends before this occurrence"
      );
      expect(requests.filter((r) => !r.startsWith("GET"))).toEqual([]);
    }
  );

  test("a start without an offset and no end saves the split", async () => {
    const { requests, run } = moveFollowing("2026-11-23T09:00:00", [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
    ]);
    const exit = await Effect.runPromiseExit(run);
    expect(Exit.isSuccess(exit)).toBe(true);
    // The old series is cut and the new one written.
    expect(requests.filter((r) => !r.startsWith("GET")).length).toBeGreaterThan(
      0
    );
  });
});
