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
    const exit = await Effect.runPromiseExit(
      service.deleteEvent("primary", added.id, "following")
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain(
      "Delete this and following isn't available"
    );
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
});
