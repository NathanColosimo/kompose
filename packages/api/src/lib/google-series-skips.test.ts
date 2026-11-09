import { describe, expect, test } from "bun:test";
import { carryCountExactly } from "@kompose/google-cal/recurrence-utils";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import {
  dateValues,
  matchRecurrenceToStart,
  moveSkippedDays,
} from "@kompose/google-cal/until";
import { Exit } from "effect";
import { Temporal } from "temporal-polyfill";
import {
  edit,
  fakeGoogle,
  nov16,
  occurrenceOf,
  run,
  weekly,
  zone,
} from "./google-test-fixtures";

// Skips (EXDATE) and occurrences deleted on their own stay where their
// meetings go when a save moves a series' time or makes it all day.

describe("an Entire series save the client lined up", () => {
  test("made all day, keeps a day with a live added meeting", async () => {
    // Daily 9:00 New York; Nov 30's 9:00 skipped, an added 15:00 that day
    // still on. Made all day, the client keeps Nov 30 as an added date;
    // the server's copy of the old skip mustn't cancel it.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=DAILY",
        "EXDATE:20261130T140000Z",
        "RDATE:20261130T200000Z",
      ],
    };
    const start = { date: "2026-11-09" };
    const sent = matchRecurrenceToStart(
      series.recurrence ?? [],
      start,
      zone,
      series.start
    );
    expect(sent).toContain("RDATE;VALUE=DATE:20261130");
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { date: "2026-11-10" },
            recurrence: sent,
            start,
          })
        )
      )
    ).toBe(true);
    const written = google.writes()[0]?.body?.recurrence ?? [];
    expect(written).toContain("RDATE;VALUE=DATE:20261130");
    expect(JSON.stringify(written)).not.toContain("EXDATE");
  });

  test("an end the save sets is read at the new time", async () => {
    // Mondays 9:00 to Nov 30; moved to 8:00 and set to end with Dec 7's
    // 8:00 meeting, which stays.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T140000Z"],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: "2026-11-09T08:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261207T130000Z"],
            start: { dateTime: "2026-11-09T08:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261207T130000Z",
    ]);
  });
});

describe("a skipped added meeting in the hour a clock change repeats", () => {
  test("stays the only skip when the series moves to another time", async () => {
    // Daily at 1:30 New York from Oct 25, with an added meeting at Nov 1's
    // second 1:30 (6:30 UTC), skipped. Moved to 2:30, the rule's Nov 1
    // meeting (the first 1:30, now 2:30) stays.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2026-10-25T02:00:00-04:00", timeZone: zone },
      recurrence: [
        "RRULE:FREQ=DAILY",
        "RDATE:20261101T063000Z",
        "EXDATE:20261101T063000Z",
      ],
      start: { dateTime: "2026-10-25T01:30:00-04:00", timeZone: zone },
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: "2026-10-25T03:00:00-04:00", timeZone: zone },
            start: { dateTime: "2026-10-25T02:30:00-04:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY",
      "RDATE:20261101T063000Z",
      "EXDATE:20261101T063000Z",
    ]);
  });
});

describe("This and following", () => {
  test("keeps an occurrence deleted after the split skipped", async () => {
    // Nov 30 and Nov 9 were deleted one at a time (cancelled exceptions,
    // not EXDATEs). Split at Nov 16 and moved to 10:00: Nov 30 stays
    // skipped, at the new time; Nov 9 belongs to the old part.
    const cancelled = (original: string): Event => ({
      ...occurrenceOf(weekly, original),
      status: "cancelled",
    });
    const google = fakeGoogle(weekly, [
      cancelled("2026-11-09T09:00:00-05:00"),
      cancelled("2026-11-30T09:00:00-05:00"),
    ]);
    const exit = await run(
      edit("following", nov16, {
        end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const list = google.requests.find((request) =>
      request.url.pathname.endsWith("/events")
    );
    expect(list?.url.searchParams.get("iCalUID")).toBe("series@google.com");
    // Skipped at 10:00 (Google takes it in UTC).
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261130T150000Z",
    ]);
  });
});

describe("This and following to other days", () => {
  test("moves the rule's own skip with its meeting", async () => {
    // Mondays at 9:00 with Nov 30 skipped in the rule; from Nov 16, moved
    // to Tuesdays at 10:00. Nov 30's meeting is now Tue Dec 1 at 10:00, so
    // the skip goes there; left on Monday, Dec 1 would come back.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261130T140000Z"],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-17T10:30:00-05:00", timeZone: zone },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=TU",
              "EXDATE:20261130T140000Z",
            ],
            start: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE:20261201T150000Z",
    ]);
  });
});

describe("This and following to other days, with skips and added meetings", () => {
  test("a rule skip doesn't land on an added meeting kept", async () => {
    // Mondays 9:00, Nov 30 skipped, plus an added Tue Dec 1 10:00; from
    // Nov 16 moved to Tuesdays at 10:00. Nov 30's place is the added Dec 1.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "EXDATE:20261130T140000Z",
        "RDATE;TZID=America/New_York:20261201T100000",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-17T10:30:00-05:00", timeZone: zone },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=TU",
              "EXDATE:20261130T140000Z",
              "RDATE;TZID=America/New_York:20261201T100000",
            ],
            start: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).not.toContainEqual(
      expect.stringContaining("EXDATE")
    );
  });

  test("made all day, skips and deleted occurrences go to their days", async () => {
    // Mondays 9:00, Dec 7 skipped, Nov 30 deleted; from Nov 16 moved to
    // Tuesdays, all day.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261207T140000Z"],
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
            end: { date: "2026-11-18" },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=TU",
              "EXDATE:20261207T140000Z",
            ],
            start: { date: "2026-11-17" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE;VALUE=DATE:20261201,20261208",
    ]);
  });

  test("made timed, skips and deleted occurrences go to their days at the new time", async () => {
    const series: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;VALUE=DATE:20261207"],
      start: { date: "2026-11-09" },
    };
    // The all-day occurrence originally on `day`.
    const onDay = (day: string): Event => ({
      ...series,
      end: { date: Temporal.PlainDate.from(day).add({ days: 1 }).toString() },
      id: `series_${day.replaceAll("-", "")}`,
      originalStartTime: { date: day },
      recurrence: undefined,
      recurringEventId: "series",
      start: { date: day },
    });
    const google = fakeGoogle(series, [
      { ...onDay("2026-11-30"), status: "cancelled" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", onDay("2026-11-16"), {
            end: { dateTime: "2026-11-17T10:30:00-05:00", timeZone: zone },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=TU",
              "EXDATE;VALUE=DATE:20261207",
            ],
            start: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE:20261201T150000Z,20261208T150000Z",
    ]);
  });
});

describe("an Entire series save that keeps its slots", () => {
  test("writes another app's date values as they were", async () => {
    // A 9:00 series with a date UNTIL and skip, renamed.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261214",
        "EXDATE;VALUE=DATE:20261130",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(edit("all", series, { summary: "Planning (renamed)" }))
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual(series.recurrence);
  });
});

describe("a skip a client moved onto one where nothing met", () => {
  test("keeps the moved meeting skipped", async () => {
    // Mondays 9:00, Nov 30 skipped at 9:00, plus an old skip at 10:00
    // where nothing met. From Nov 16 moved to 10:00; the client sends its
    // 9:00 skip moved to 10:00, which is the old one too.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "EXDATE:20261130T140000Z,20261130T150000Z",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=MO",
              "EXDATE:20261130T150000Z",
            ],
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261130T150000Z",
    ]);
  });
});

describe("This and following made all day on another day", () => {
  test("drops a deleted added meeting from both lists", async () => {
    // Mondays at 9:00 plus an added Wed Dec 2 at 15:00, deleted on its
    // own; from Nov 16 moved to Tue Nov 17, all day, on Tuesdays. A timed
    // skip can't stay in an all-day series, and the added day it cancels
    // goes with it.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261202T150000",
      ],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-12-02T15:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { date: "2026-11-18" },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=TU",
              "RDATE;TZID=America/New_York:20261202T150000",
            ],
            start: { date: "2026-11-17" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
    ]);
  });
});

describe("Entire series", () => {
  test("an all-day series made timed counts its days in the new start's zone", async () => {
    // Daily all day Nov 8-12, Nov 10 skipped, made 21:00 New York.
    const master: Event = {
      end: { date: "2026-11-09" },
      iCalUID: "series@google.com",
      id: "series",
      recurrence: [
        "RRULE:FREQ=DAILY;UNTIL=20261112",
        "EXDATE;VALUE=DATE:20261110",
      ],
      start: { date: "2026-11-08" },
      summary: "Standup",
    };
    const google = fakeGoogle(master);
    const exit = await run(
      edit("all", master, {
        end: { dateTime: "2026-11-08T21:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-08T21:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    // Through Nov 12 at 21:00 New York, and Nov 10 at 21:00 skipped.
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY;UNTIL=20261113T045959Z",
      "EXDATE:20261111T020000Z",
    ]);
  });
});

describe("what Google keeps as an occurrence's own", () => {
  test("an Entire series time change keeps a deleted occurrence deleted", async () => {
    // Nov 30 was deleted on its own (a cancelled exception at 9:00); at
    // 10:00 it would be a new meeting unless skipped there.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    const exit = await run(
      edit("all", weekly, {
        end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    // Skipped at 10:00 (Google takes it in UTC).
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261130T150000Z",
    ]);
  });
});

describe("series shapes a write has to keep as they are", () => {
  test("a rename leaves a rule at its own hour, not the start's", async () => {
    // Starts Mon Nov 9 9:00, then meets Mondays at 10:00 (BYHOUR=10, as an
    // imported calendar may write it); Nov 23 was moved on its own.
    const series = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=10"],
    };
    const google = fakeGoogle(series, [
      occurrenceOf(series, "2026-11-23T10:00:00-05:00", {
        end: "2026-11-23T11:30:00-05:00",
        start: "2026-11-23T11:00:00-05:00",
      }),
    ]);
    const opened = occurrenceOf(series, "2026-11-16T10:00:00-05:00");
    expect(
      Exit.isSuccess(await run(edit("all", opened, { summary: "Check-in" })))
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=10"],
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
      summary: "Check-in",
    });
  });
});

describe("This and following, where the new series sits", () => {
  test("a time change moves a rule that sets its own hour", async () => {
    // Starts Mon Nov 9 9:00, then meets Mondays at 10:00 (BYHOUR=10).
    // From Nov 16's 10:00, the following meetings move to 11:00.
    const series = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=10"],
    };
    const google = fakeGoogle(series);
    const opened = occurrenceOf(series, "2026-11-16T10:00:00-05:00");
    expect(
      Exit.isSuccess(
        await run(
          edit("following", opened, {
            end: { dateTime: "2026-11-16T11:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T11:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=11"],
      start: { dateTime: "2026-11-16T11:00:00-05:00", timeZone: zone },
    });
  });
});

describe("a series of added days only", () => {
  test("keeps a deleted one deleted when made timed", async () => {
    // All day Nov 9, plus added Nov 16 and Nov 23 (no rule); Nov 23 was
    // deleted on its own. Made 9:00, it's skipped at 9:00.
    const series: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      recurrence: ["RDATE;VALUE=DATE:20261116,20261123"],
      start: { date: "2026-11-09" },
    };
    const deleted: Event = {
      ...series,
      end: { date: "2026-11-24" },
      id: "series_20261123",
      originalStartTime: { date: "2026-11-23" },
      recurrence: undefined,
      recurringEventId: "series",
      start: { date: "2026-11-23" },
      status: "cancelled",
    };
    const google = fakeGoogle(series, [deleted]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: "2026-11-09T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RDATE:20261116T140000Z,20261123T140000Z",
      "EXDATE:20261123T140000Z",
    ]);
  });
});

describe("a series made all day", () => {
  test("keeps its deleted first meeting deleted", async () => {
    // Nov 9 9:00 plus added Nov 16 and Nov 23; the first meeting was
    // deleted on its own. Made all day through Nov 16, Nov 9 stays
    // skipped, as a date.
    const series: Event = {
      ...weekly,
      recurrence: ["RDATE:20261116T140000Z,20261123T140000Z"],
    };
    const deleted: Event = {
      ...occurrenceOf(series, "2026-11-09T09:00:00-05:00"),
      status: "cancelled",
    };
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    const google = fakeGoogle(series, [deleted]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", opened, {
            end: { date: "2026-11-17" },
            start: { date: "2026-11-16" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: [
        "RDATE;VALUE=DATE:20261116,20261123",
        "EXDATE;VALUE=DATE:20261109",
      ],
      start: { date: "2026-11-09" },
    });
  });
});

describe("a series made all day, its start also an added day", () => {
  test("keeps its deleted first meeting deleted", async () => {
    // As above, but the added days list Nov 9 too: it's still the
    // start's meeting, so its skip stays.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RDATE;TZID=America/New_York:20261109T090000,20261116T090000,20261123T090000",
      ],
    };
    const deleted: Event = {
      ...occurrenceOf(series, "2026-11-09T09:00:00-05:00"),
      status: "cancelled",
    };
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    const google = fakeGoogle(series, [deleted]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", opened, {
            end: { date: "2026-11-17" },
            start: { date: "2026-11-16" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: [
        "RDATE;VALUE=DATE:20261109,20261116,20261123",
        "EXDATE;VALUE=DATE:20261109",
      ],
      start: { date: "2026-11-09" },
    });
  });
});

describe("an Entire series time change, a deleted meeting also an added day", () => {
  test("skips it at both the added time and the series' new time", async () => {
    // Mondays 9:00, with Nov 30 9:00 also listed as an added day; Nov 30
    // was deleted on its own. At 10:00 the rule's Nov 30 moves to 10:00
    // and the added one stays at 9:00: both stay skipped.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261130T090000",
      ],
    };
    const deleted: Event = {
      ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"),
      status: "cancelled",
    };
    const google = fakeGoogle(series, [deleted]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    // At 9:00 (14:00Z) and 10:00 (15:00Z).
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261130T090000",
      "EXDATE:20261130T140000Z",
      "EXDATE:20261130T150000Z",
    ]);
  });
});

describe("an Entire series edit that moves the rule's own hour with the start", () => {
  test("keeps a deleted occurrence skipped at the new time", async () => {
    // Mondays at 9:00 written with BYHOUR=9; Nov 30 deleted on its own.
    // Made daily at 10:00 with the rule's hour sent along (BYHOUR=10):
    // one time a day, so the skip moves to 10:00.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9"],
    };
    const deleted: Event = {
      ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"),
      status: "cancelled",
    };
    const google = fakeGoogle(series, [deleted]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=DAILY;BYHOUR=10"],
            start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    // Skipped at 10:00 (Google takes it in UTC).
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY;BYHOUR=10",
      "EXDATE:20261130T150000Z",
    ]);
  });
});

describe("skips for deleted occurrences when the series' time moves", () => {
  const toTen = (series: Event, recurrence?: string[]) =>
    edit("all", series, {
      end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
      ...(recurrence ? { recurrence } : {}),
      start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
    });
  const cancelled = (series: Event, original: string): Event => ({
    ...occurrenceOf(series, original),
    status: "cancelled",
  });

  test("a deleted first meeting stays deleted when the rule's hour is sent too", async () => {
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9"],
    };
    const google = fakeGoogle(series, [
      cancelled(series, "2026-11-09T09:00:00-05:00"),
    ]);
    expect(
      Exit.isSuccess(
        await run(toTen(series, ["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=10"]))
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=10",
      "EXDATE:20261109T150000Z",
    ]);
  });

  test("a deleted added meeting off the rule's days keeps one skip, its own", async () => {
    // Mondays plus an added Tue Dec 1 9:00, deleted on its own.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261201T090000",
      ],
    };
    const google = fakeGoogle(series, [
      cancelled(series, "2026-12-01T09:00:00-05:00"),
    ]);
    expect(Exit.isSuccess(await run(toTen(series)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261201T090000",
      "EXDATE:20261201T140000Z",
    ]);
  });

  test("a deleted added meeting at another time on a rule day doesn't skip the rule's", async () => {
    // Mondays plus an added Nov 30 15:00, deleted on its own: the rule's
    // Nov 30 meeting, now at 10:00, stays.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261130T150000",
      ],
    };
    const google = fakeGoogle(series, [
      cancelled(series, "2026-11-30T15:00:00-05:00"),
    ]);
    expect(Exit.isSuccess(await run(toTen(series)))).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261130T150000",
      "EXDATE:20261130T200000Z",
    ]);
  });

  test("a deleted meeting's skip doesn't land on an added meeting still on", async () => {
    // Mondays 9:00 plus an added Nov 30 10:00 (still on); the rule's
    // Nov 30 9:00 was deleted. At 10:00 the added meeting stays.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261130T100000",
      ],
    };
    const google = fakeGoogle(series, [
      cancelled(series, "2026-11-30T09:00:00-05:00"),
    ]);
    expect(Exit.isSuccess(await run(toTen(series)))).toBe(true);
    const recurrence = google.writes()[0]?.body?.recurrence as string[];
    expect(recurrence.filter((line) => line.startsWith("EXDATE"))).toEqual([]);
  });
});

describe("skips placed against the series being saved", () => {
  // Mondays 9:00; Nov 30's 9:00 was deleted on its own.
  const deletedNov30 = (series: Event): Event => ({
    ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"),
    status: "cancelled",
  });
  const addedTen = "RDATE;TZID=America/New_York:20261130T100000";
  const atTen = {
    end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
    start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
  };
  const exdates = (recurrence: unknown) =>
    (recurrence as string[]).filter((line) => line.startsWith("EXDATE"));

  const scopes = [["all"], ["following"]] as const;

  test.each(scopes)(
    "an added meeting the save removes doesn't shield the deleted one (%s)",
    async (scope) => {
      const series = {
        ...weekly,
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", addedTen],
      };
      const google = fakeGoogle(series, [deletedNov30(series)]);
      const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, opened, {
              ...atTen,
              recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
            })
          )
        )
      ).toBe(true);
      // This and following keeps an added day still on that a rule sent
      // alone leaves out: no skip lands on it.
      expect(exdates(google.writes()[0]?.body?.recurrence)).toEqual(
        scope === "all" ? ["EXDATE:20261130T150000Z"] : []
      );
    }
  );

  test.each(scopes)(
    "an added meeting the save adds isn't skipped (%s)",
    async (scope) => {
      const google = fakeGoogle(weekly, [deletedNov30(weekly)]);
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, nov16, {
              ...atTen,
              recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", addedTen],
            })
          )
        )
      ).toBe(true);
      expect(exdates(google.writes()[0]?.body?.recurrence)).toEqual([]);
    }
  );

  test.each(scopes)(
    "a skip the rule already has moves when the rule's hour is sent too (%s)",
    async (scope) => {
      // Mondays 9:00 written with BYHOUR=9, Nov 30 skipped (an EXDATE).
      const series: Event = {
        ...weekly,
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
          "EXDATE:20261130T140000Z",
        ],
      };
      const google = fakeGoogle(series);
      const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, opened, {
              ...atTen,
              recurrence: [
                "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=10",
                "EXDATE:20261130T140000Z",
              ],
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=10",
        "EXDATE:20261130T150000Z",
      ]);
    }
  );
});

describe("a deleted added meeting the save removes", () => {
  // Mondays 9:00 plus an added Nov 30 15:00, deleted on its own; the save
  // drops that added day. The rule's Nov 30 meeting must stay.
  const series: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261130T150000",
    ],
  };
  const deleted: Event = {
    ...occurrenceOf(series, "2026-11-30T15:00:00-05:00"),
    status: "cancelled",
  };
  const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
  const cases = [
    ["all", "09:00"],
    ["all", "10:00"],
    ["following", "09:00"],
    ["following", "10:00"],
  ] as const;

  test.each(cases)("leaves no skip behind (%s, at %s)", async (scope, time) => {
    const google = fakeGoogle(series, [deleted]);
    expect(
      Exit.isSuccess(
        await run(
          edit(scope, opened, {
            end: {
              dateTime: `2026-11-16T${time.replace(":00", ":30")}:00-05:00`,
              timeZone: zone,
            },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
            start: { dateTime: `2026-11-16T${time}:00-05:00`, timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
    ]);
  });
});

describe("a skipped added meeting the save removes, its skip in the rule", () => {
  // As above, but Nov 30 15:00 was skipped with an EXDATE, which the save
  // sends along while dropping the added day.
  const skip = "EXDATE;TZID=America/New_York:20261130T150000";
  const series: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261130T150000",
      skip,
    ],
  };
  const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
  const cases = [
    ["all", "09:00"],
    ["all", "10:00"],
    ["following", "09:00"],
    ["following", "10:00"],
  ] as const;

  test.each(cases)(
    "takes its skip with it (%s, at %s)",
    async (scope, time) => {
      const google = fakeGoogle(series);
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, opened, {
              end: {
                dateTime: `2026-11-16T${time.replace(":00", ":30")}:00-05:00`,
                timeZone: zone,
              },
              recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", skip],
              start: {
                dateTime: `2026-11-16T${time}:00-05:00`,
                timeZone: zone,
              },
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
      ]);
    }
  );
});

describe("a This and following move onto a deleted added meeting", () => {
  test("keeps the meeting just saved there", async () => {
    // Mondays 9:00 plus an added Tue Nov 17 9:00, deleted on its own; from
    // Nov 16, moved to Nov 17 9:00: the moved meeting is there.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "RDATE:20261117T140000Z"],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-17T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
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
    const created = google.writes()[0]?.body?.recurrence;
    expect(JSON.stringify(created)).not.toContain("EXDATE");
  });
});

describe("a whole day skipped in a timed series", () => {
  test("stays skipped for its added meetings too", async () => {
    // Mondays 9:00 plus an added Nov 30 15:00, Nov 30 skipped as a date;
    // renamed from Nov 16, neither Nov 30 meeting comes back.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261130T150000",
        "EXDATE;VALUE=DATE:20261130",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    const written = JSON.stringify(google.writes()[0]?.body?.recurrence);
    for (const skip of ["20261130T140000Z", "20261130T200000Z"]) {
      expect(written).toContain(skip);
    }
  });
});

describe("an Entire series save that moves the first meeting's day and time", () => {
  test.each([
    ["weekly", "RRULE:FREQ=WEEKLY;BYDAY=MO", "2026-11-16"],
    ["daily", "RRULE:FREQ=DAILY", "2026-11-10"],
  ])(
    "moves the rule's own skips to the new time (%s)",
    async (_how, rule, day) => {
      // 9:00 from Mon Nov 9, Nov 30 skipped; the first meeting moves to a
      // later day at 10:00: Nov 30 stays skipped at 10:00.
      const series: Event = {
        ...weekly,
        recurrence: [rule, "EXDATE:20261130T140000Z"],
      };
      const google = fakeGoogle(series);
      expect(
        Exit.isSuccess(
          await run(
            edit("all", series, {
              end: { dateTime: `${day}T10:30:00-05:00`, timeZone: zone },
              start: { dateTime: `${day}T10:00:00-05:00`, timeZone: zone },
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        rule,
        "EXDATE:20261130T150000Z",
      ]);
    }
  );

  test("moves them by as much across midnight", async () => {
    // Daily 23:00 from Nov 9, Nov 20 skipped; the first meeting moves to
    // Nov 10 00:30. Nov 20's meeting is Nov 21 00:30 now; Nov 20 00:30 is
    // Nov 19's.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2026-11-09T23:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY", "EXDATE:20261121T040000Z"],
      start: { dateTime: "2026-11-09T23:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: "2026-11-10T01:00:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-10T00:30:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY",
      "EXDATE:20261121T053000Z",
    ]);
  });
});

describe("a deleted added meeting the save removes, its day's meeting moving onto it", () => {
  test.each([["all"], ["following"]] as const)(
    "doesn't cancel that meeting (%s)",
    async (scope) => {
      // Daily 9:00 plus an added Nov 20 10:00, deleted on its own; moved to
      // 10:00, the rule sent without the added day. Nov 20's own meeting,
      // now at 10:00, stays.
      const series: Event = {
        ...weekly,
        recurrence: ["RRULE:FREQ=DAILY", "RDATE:20261120T150000Z"],
      };
      const google = fakeGoogle(series, [
        {
          ...occurrenceOf(series, "2026-11-20T10:00:00-05:00"),
          status: "cancelled",
        },
      ]);
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
              end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
              recurrence: ["RRULE:FREQ=DAILY"],
              start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
            })
          )
        )
      ).toBe(true);
      expect(
        JSON.stringify(google.writes()[0]?.body?.recurrence)
      ).not.toContain("20261120T150000Z");
    }
  );
});

describe("a deleted meeting's skip through a short move on a clock-change day", () => {
  test.each([
    ["2:30", "02:30", "20261101T073000Z"],
    ["3:30", "03:30", "20261101T083000Z"],
  ])("lands on the moved meeting (to %s)", async (_label, time, skip) => {
    // Daily 1:30 New York from Oct 25; Nov 1's 1:30 (the first, before
    // clocks go back) deleted on its own. Moved later the same night.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2026-10-25T02:00:00-04:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { dateTime: "2026-10-25T01:30:00-04:00", timeZone: zone },
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-01T01:30:00-04:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: `2026-10-25T${time}:00-04:00`, timeZone: zone },
            start: { dateTime: `2026-10-25T${time}:00-04:00`, timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(JSON.stringify(google.writes()[0]?.body?.recurrence)).toContain(
      skip
    );
  });
});

describe("a deleted meeting's skip through a short move onto another weekday", () => {
  test("stays on its own day where the saved rule meets", async () => {
    // Mondays and Wednesdays 9:00 from Nov 9, Wed Nov 18 deleted; the first
    // meeting moves to Tue Nov 10 8:00, the rule to Tuesdays and Wednesdays.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-18T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: "2026-11-10T08:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,WE"],
            start: { dateTime: "2026-11-10T08:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU,WE",
      "EXDATE:20261118T130000Z",
    ]);
  });
});

describe("This and following with a new pattern from the same day", () => {
  test("places a later deleted meeting's skip by the new pattern", async () => {
    // Second Mondays from Sep 14, Dec 14 deleted; from Nov 9, third Mondays
    // instead: December's meeting is Dec 21 now, and stays deleted.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2026-09-14T09:30:00-04:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=2MO"],
      start: { dateTime: "2026-09-14T09:00:00-04:00", timeZone: zone },
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-12-14T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-09T09:00:00-05:00"), {
            recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=3MO"],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=MONTHLY;BYDAY=3MO",
      "EXDATE:20261221T140000Z",
    ]);
  });
});

describe("This and following to a new time the same day", () => {
  test("drops a COUNT place for a deleted meeting whose new time doesn't exist", async () => {
    // Daily 9:00 New York ten times from Mar 10 2027, Mar 14 deleted; from
    // Mar 12 moved to 2:30, an hour Mar 14 skips (clocks go forward): its
    // deleted meeting has no place, so seven are left, not eight.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2027-03-10T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=10"],
      start: { dateTime: "2027-03-10T09:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2027-03-14T09:00:00-04:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2027-03-12T09:00:00-05:00"), {
            end: { dateTime: "2027-03-12T03:00:00-05:00", timeZone: zone },
            start: { dateTime: "2027-03-12T02:30:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(JSON.stringify(google.writes()[0]?.body?.recurrence)).toContain(
      "RRULE:FREQ=DAILY;COUNT=7"
    );
  });

  test("keeps an end on the moved last meeting's day across midnight", async () => {
    // Daily 23:00 New York, its last meeting Nov 19; from Nov 16 moved to
    // Nov 17 00:30: that meeting is Nov 20 00:30 now, and stays.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2026-11-09T23:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY;UNTIL=20261121T035959Z"],
      start: { dateTime: "2026-11-09T23:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T23:00:00-05:00"), {
            end: { dateTime: "2026-11-17T01:00:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-17T00:30:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY;UNTIL=20261121T045959Z",
    ]);
  });
});

describe("an Entire series rule change alone", () => {
  test("adds no skip for a rule meeting deleted on its own", async () => {
    // Nov 23 deleted on its own; Mondays become Mondays and Wednesdays.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"] })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
    ]);
  });
});

describe("a removed added day's skip the saved series still needs", () => {
  test.each([["all"], ["following"]] as const)(
    "stays when the saved rule meets there (%s)",
    async (scope) => {
      // Mondays plus an added Tue Dec 1 9:00, deleted on its own; the save
      // makes it Mondays and Tuesdays and drops the added day. Dec 1 9:00
      // is the rule's now, and stays deleted.
      const series: Event = {
        ...weekly,
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261201T090000",
        ],
      };
      const deleted: Event = {
        ...occurrenceOf(series, "2026-12-01T09:00:00-05:00"),
        status: "cancelled",
      };
      const google = fakeGoogle(series, [deleted]);
      const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, opened, {
              recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU"],
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO,TU",
        "EXDATE:20261201T140000Z",
      ]);
    }
  );

  test.each([["all"], ["following"]] as const)(
    "stays as a date when the series is made all day (%s)",
    async (scope) => {
      // Mondays 9:00 plus an added Nov 30 15:00, both Nov 30 meetings
      // skipped. Made all day, the client sends the day skipped as a date
      // and the added day dropped: Nov 30 stays skipped.
      const series: Event = {
        ...weekly,
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261130T150000",
          "EXDATE;TZID=America/New_York:20261130T090000,20261130T150000",
        ],
      };
      const google = fakeGoogle(series);
      const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, opened, {
              end: { date: "2026-11-17" },
              recurrence: [
                "RRULE:FREQ=WEEKLY;BYDAY=MO",
                "EXDATE;VALUE=DATE:20261130",
              ],
              start: { date: "2026-11-16" },
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "EXDATE;VALUE=DATE:20261130",
      ]);
    }
  );
});

describe("This and following: a removed added day the new rule reaches from the split", () => {
  test.each([
    ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU"],
    ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU;COUNT=6"],
  ])("keeps its skip (%s)", async (rule) => {
    // Mondays from Nov 9 plus an added Tue Dec 1 9:00, deleted on its own.
    // From Nov 16 the new rule meets Dec 1 (counted from Nov 16, not Nov
    // 9), so Dec 1 stays skipped.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261201T090000",
      ],
    };
    const deleted: Event = {
      ...occurrenceOf(series, "2026-12-01T09:00:00-05:00"),
      status: "cancelled",
    };
    const google = fakeGoogle(series, [deleted]);
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { recurrence: [rule] }))
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      rule,
      "EXDATE:20261201T140000Z",
    ]);
  });
});

describe("a removed added day's skip, read where the saved series meets", () => {
  // Mondays 9:00 plus an added Tue Dec 1 9:00, deleted on its own; the
  // save makes it Mondays and Tuesdays and drops the added day.
  const series: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261201T090000",
    ],
  };
  const deleted: Event = {
    ...occurrenceOf(series, "2026-12-01T09:00:00-05:00"),
    status: "cancelled",
  };
  const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
  const save = (scope: "all" | "following", changes: Partial<CreateEvent>) => {
    const google = fakeGoogle(series, [deleted]);
    return run(edit(scope, opened, changes)).then((exit) => {
      expect(Exit.isSuccess(exit)).toBe(true);
      return google.writes()[0]?.body?.recurrence;
    });
  };
  const scopes = [["all"], ["following"]] as const;

  test.each(scopes)("made all day, Dec 1 stays skipped (%s)", async (scope) => {
    expect(
      await save(scope, {
        end: { date: "2026-11-17" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU"],
        start: { date: "2026-11-16" },
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU", "EXDATE;VALUE=DATE:20261201"]);
  });

  test.each([
    ["all", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU"],
    ["all", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU;BYHOUR=10"],
    ["following", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU"],
    ["following", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU;BYHOUR=10"],
  ] as const)(
    "moved to 10:00, Dec 1 stays skipped there (%s, %s)",
    async (scope, rule) => {
      expect(
        await save(scope, {
          end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
          recurrence: [rule],
          start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
        })
      ).toEqual([rule, "EXDATE:20261201T150000Z"]);
    }
  );
});

describe("a deleted added meeting through a save that adds its weekday", () => {
  const added = "RDATE;TZID=America/New_York:20261201T090000";
  const tenAm = {
    end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
    start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
  };

  test.each([["all"], ["following"]] as const)(
    "kept added day: only its own skip, not the rule's new meeting (%s)",
    async (scope) => {
      // Mondays 9:00 plus an added Tue Dec 1 9:00, deleted on its own. The
      // save keeps the added day, adds Tuesdays and moves to 10:00: the
      // rule's new Dec 1 10:00 stays.
      const series: Event = {
        ...weekly,
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", added],
      };
      const google = fakeGoogle(series, [
        {
          ...occurrenceOf(series, "2026-12-01T09:00:00-05:00"),
          status: "cancelled",
        },
      ]);
      const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, opened, {
              ...tenAm,
              recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU", added],
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO,TU",
        added,
        "EXDATE:20261201T140000Z",
      ]);
    }
  );

  // Mondays 9:00 written with BYHOUR=9, plus an added Tue Dec 1 9:00,
  // deleted on its own (a cancelled exception, or an EXDATE). The save
  // keeps BYHOUR=9, adds Tuesdays, drops the added day and moves to 10:00:
  // the rule is lined up to 10:00 and meets Dec 1 there, so it's skipped.
  const exdate = "EXDATE;TZID=America/New_York:20261201T090000";

  test.each([
    ["all", "cancelled"],
    ["all", "exdate"],
    ["following", "cancelled"],
    ["following", "exdate"],
  ] as const)(
    "dropped added day under a kept hour: skipped at 10:00 (%s, %s)",
    async (scope, source) => {
      const series: Event = {
        ...weekly,
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9",
          added,
          ...(source === "exdate" ? [exdate] : []),
        ],
      };
      const google = fakeGoogle(
        series,
        source === "cancelled"
          ? [
              {
                ...occurrenceOf(series, "2026-12-01T09:00:00-05:00"),
                status: "cancelled",
              },
            ]
          : []
      );
      const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
      expect(
        Exit.isSuccess(
          await run(
            edit(scope, opened, {
              ...tenAm,
              recurrence: [
                "RRULE:FREQ=WEEKLY;BYDAY=MO,TU;BYHOUR=9",
                ...(source === "exdate" ? [exdate] : []),
              ],
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([
        "RRULE:FREQ=WEEKLY;BYDAY=MO,TU;BYHOUR=10",
        "EXDATE:20261201T150000Z",
      ]);
    }
  );
});

describe("a COUNT made all day", () => {
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
});

describe("a skip where nothing meets", () => {
  // Mondays at 9:00 from Nov 9, with a skip at 8:00 on Nov 23 that skips
  // nothing: moved onto 9:00 (or a new time) it would cancel a meeting.
  const stale: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;TZID=America/New_York:20261123T080000",
    ],
  };
  const at = (dateTime: string) => ({ dateTime, timeZone: zone });

  test.each([
    ["Entire series", "all", {}],
    [
      "Entire series, moved to 10:00",
      "all",
      {
        end: at("2026-11-16T10:30:00-05:00"),
        start: at("2026-11-16T10:00:00-05:00"),
      },
    ],
    ["This and following", "following", {}],
  ] as const)("stays where it is through %s", async (_save, scope, times) => {
    const google = fakeGoogle(stale);
    expect(
      Exit.isSuccess(
        await run(
          edit(scope, occurrenceOf(stale, "2026-11-16T09:00:00-05:00"), {
            summary: "Planning (new)",
            ...times,
          })
        )
      )
    ).toBe(true);
    // Every write keeps it at Nov 23 8:00 New York, however it's written.
    const skips = google
      .writes()
      .flatMap((write) =>
        dateValues(
          (write.body?.recurrence as string[] | undefined) ?? [],
          "EXDATE",
          zone
        )
      )
      .map((value) => value.instant?.toString());
    expect(skips.length).toBeGreaterThan(0);
    expect(new Set(skips)).toEqual(new Set(["2026-11-23T13:00:00Z"]));
  });

  test.each([
    ["Entire series", "all"],
    ["This and following", "following"],
  ] as const)("goes when %s moves to its time", async (_save, scope) => {
    // Moved to 8:00, the series meets Nov 23 at 8:00: kept, the skip
    // would cancel that meeting.
    const google = fakeGoogle(stale);
    expect(
      Exit.isSuccess(
        await run(
          edit(scope, occurrenceOf(stale, "2026-11-16T09:00:00-05:00"), {
            end: at("2026-11-16T08:30:00-05:00"),
            start: at("2026-11-16T08:00:00-05:00"),
          })
        )
      )
    ).toBe(true);
    const written = google.writes()[0]?.body?.recurrence as string[];
    expect(dateValues(written, "EXDATE", zone)).toEqual([]);
  });
});

describe("a deleted added meeting the series moves onto", () => {
  // Mondays at 9:00, plus Nov 23 at 8:00 added and then deleted on its own.
  const added: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261123T080000",
    ],
  };
  const at = (dateTime: string) => ({ dateTime, timeZone: zone });

  test("goes when the series moves to its time on a day it meets", async () => {
    // Moved to 8:00, Nov 23's own meeting is at 8:00: a skip there would
    // cancel it.
    const google = fakeGoogle(added, [
      {
        ...occurrenceOf(added, "2026-11-23T08:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(added, "2026-11-16T09:00:00-05:00"), {
            end: at("2026-11-16T08:30:00-05:00"),
            start: at("2026-11-16T08:00:00-05:00"),
          })
        )
      )
    ).toBe(true);
    const written = google.writes()[0]?.body?.recurrence as string[];
    expect(dateValues(written, "EXDATE", zone)).toEqual([]);
  });

  test("stays skipped on a day the series doesn't meet", () => {
    // Added on Tue Nov 24 at 8:00 and deleted: moving the Mondays to 8:00
    // doesn't bring it back.
    const recurrence = [
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "RDATE;TZID=America/New_York:20261124T080000",
      "EXDATE;TZID=America/New_York:20261124T080000",
    ];
    const matched = matchRecurrenceToStart(
      recurrence,
      { dateTime: "2026-11-09T08:00:00-05:00" },
      zone,
      { dateTime: "2026-11-09T09:00:00-05:00" }
    );
    expect(
      dateValues(matched ?? [], "EXDATE", zone).map((value) =>
        value.instant?.toString()
      )
    ).toEqual(["2026-11-24T13:00:00Z"]);
  });
});

describe("a skip the app already lined up for the new start", () => {
  const at = (dateTime: string) => ({ dateTime, timeZone: zone });

  test.each([
    {
      before: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "EXDATE;TZID=America/New_York:20261130T090000",
      ],
      name: "Mondays moved to Tuesdays at 10:00",
      rule: [
        "RRULE:FREQ=WEEKLY;BYDAY=TU",
        "EXDATE;TZID=America/New_York:20261201T100000",
      ],
      skip: "2026-12-01T15:00:00Z",
    },
    {
      before: [
        "RRULE:FREQ=DAILY",
        "EXDATE;TZID=America/New_York:20261120T090000",
      ],
      name: "a daily series moved to 10:00 a day later",
      rule: [
        "RRULE:FREQ=DAILY",
        "EXDATE;TZID=America/New_York:20261120T100000",
      ],
      skip: "2026-11-20T15:00:00Z",
    },
  ])("stays as written for $name", async ({ before, rule, skip }) => {
    const series: Event = { ...weekly, recurrence: [...before] };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: at("2026-11-17T10:30:00-05:00"),
            recurrence: [...rule],
            start: at("2026-11-17T10:00:00-05:00"),
          })
        )
      )
    ).toBe(true);
    const written = google.writes()[0]?.body?.recurrence as string[];
    expect(
      dateValues(written, "EXDATE", zone).map((value) =>
        value.instant?.toString()
      )
    ).toEqual([skip]);
  });
});

test("a day and time move with the rule's own hour carries a deleted occurrence's skip", async () => {
  // Mondays at 9:00 written BYHOUR=9, Nov 30 deleted; from Nov 16 moved
  // to Tuesdays at 10:00. The rule is written BYHOUR=10, and the skip
  // goes to Tue Dec 1 10:00.
  const series: Event = {
    ...weekly,
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9"],
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
          end: { dateTime: "2026-11-17T10:30:00-05:00", timeZone: zone },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=9"],
          start: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
        })
      )
    )
  ).toBe(true);
  const written = google.writes()[0]?.body?.recurrence as string[];
  expect(
    dateValues(written, "EXDATE", zone).map((value) =>
      value.instant?.toString()
    )
  ).toEqual(["2026-12-01T15:00:00Z"]);
});

test("a day move doesn't shift a skip because its own place is already skipped", async () => {
  // Weekdays at 9:00 with Thu Nov 26 both an EXDATE and listed as
  // cancelled; from Nov 16 moved to Tue Nov 17 10:00. Thursdays still
  // meet, so Nov 26 stays skipped (at 10:00) and Fri Nov 27 isn't.
  const series: Event = {
    ...weekly,
    recurrence: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      "EXDATE:20261126T140000Z",
    ],
  };
  const google = fakeGoogle(series, [
    {
      ...occurrenceOf(series, "2026-11-26T09:00:00-05:00"),
      status: "cancelled",
    },
  ]);
  expect(
    Exit.isSuccess(
      await run(
        edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
          end: { dateTime: "2026-11-17T10:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
        })
      )
    )
  ).toBe(true);
  const written = google.writes()[0]?.body?.recurrence as string[];
  expect(
    dateValues(written, "EXDATE", zone).map((value) =>
      value.instant?.toString()
    )
  ).toEqual(["2026-11-26T15:00:00Z"]);
});

describe("moveSkippedDays (the apps' rule rebuild for a new day)", () => {
  const day = (date: string) => Temporal.PlainDate.from(date);
  const nine = Temporal.PlainTime.from("09:00");
  const moved = (params: {
    from: string;
    newRule: string;
    oldRule: string;
    skips: string;
    to: string;
    timed?: boolean;
    /** The rule the recurrence holds; the new one when left out. */
    recurrenceRule?: string;
  }) =>
    moveSkippedDays({
      from: day(params.from),
      fromTime: params.timed === false ? null : nine,
      newRule: params.newRule,
      oldRule: params.oldRule,
      recurrence: [params.recurrenceRule ?? params.newRule, params.skips],
      seriesZone: zone,
      to: day(params.to),
      toTime: params.timed === false ? null : nine,
    });

  test("moves a skip with Mondays that became Tuesdays, at its own time", () => {
    // Mon Nov 23 skipped moves to Tue Nov 24; Nov 2, before the move, stays.
    expect(
      moved({
        from: "2026-11-09",
        newRule: "RRULE:FREQ=WEEKLY;BYDAY=TU",
        oldRule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        skips: "EXDATE;TZID=America/New_York:20261123T090000,20261102T090000",
        to: "2026-11-10",
      })
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE:20261124T140000Z,20261102T140000Z",
    ]);
  });

  test("keeps a skip in the hour a clock change repeats on its moment", () => {
    // Mondays from Oct 26 moved to Tuesdays; an added Nov 1 1:30 EST (the
    // second 1:30 that night) was skipped and stays skipped as it was.
    expect(
      moveSkippedDays({
        from: day("2026-10-26"),
        fromTime: nine,
        newRule: "RRULE:FREQ=WEEKLY;BYDAY=TU",
        oldRule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=TU",
          "RDATE:20261101T063000Z",
          "EXDATE:20261101T063000Z,20261102T140000Z",
        ],
        seriesZone: zone,
        to: day("2026-10-27"),
        toTime: nine,
      })
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "RDATE:20261101T063000Z",
      "EXDATE:20261101T063000Z,20261103T140000Z",
    ]);
  });

  test("leaves a skip at the second pass of a repeated hour where it is", () => {
    // Sundays at 1:30 from Oct 25, moved to Mondays, with a stale skip at
    // Nov 1's second 1:30 (6:30 UTC): the rule met at the first 1:30, so
    // that skip isn't its meeting's, and moved it would cancel Nov 2's.
    const half = Temporal.PlainTime.from("01:30");
    expect(
      moveSkippedDays({
        from: day("2026-10-25"),
        fromTime: half,
        newRule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        oldRule: "RRULE:FREQ=WEEKLY;BYDAY=SU",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261101T063000Z"],
        seriesZone: zone,
        to: day("2026-10-26"),
        toTime: half,
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261101T063000Z"]);
  });

  test("moves a skip with the old rule still in the recurrence", () => {
    expect(
      moved({
        from: "2026-11-09",
        newRule: "RRULE:FREQ=WEEKLY;BYDAY=TU",
        oldRule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        skips: "EXDATE:20261123T140000Z",
        to: "2026-11-10",
        recurrenceRule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
      }).at(-1)
    ).toBe("EXDATE:20261124T140000Z");
  });

  test("then lined up with a new time, reads the moved rule from its new day", () => {
    // Every other Sunday at 9:00 from Nov 1, Nov 29 skipped; from Nov 15
    // moved to Monday Nov 16 at 10:00. The skip goes to Nov 30 (a week
    // of the moved rule, counted from Nov 16), then to its 10:00.
    const oldRule = "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;BYHOUR=9";
    const newRule = "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9";
    const onMonday = moveSkippedDays({
      from: day("2026-11-15"),
      fromTime: nine,
      newRule,
      oldRule,
      recurrence: [newRule, "EXDATE:20261129T140000Z"],
      seriesZone: zone,
      to: day("2026-11-16"),
      toTime: Temporal.PlainTime.from("10:00"),
    });
    expect(onMonday).toEqual([newRule, "EXDATE:20261130T140000Z"]);
    expect(
      matchRecurrenceToStart(
        onMonday,
        { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
        zone,
        { dateTime: "2026-11-15T09:00:00-05:00", timeZone: zone },
        { rulesFrom: day("2026-11-16") }
      )
    ).toEqual([
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=10",
      "EXDATE:20261130T150000Z",
    ]);
  });

  test("leaves a skip where nothing met where it is", () => {
    // Mondays at 9:00 with a stale 8:00 Nov 30 skip: moved to Tuesdays, it
    // would cancel Dec 1's 9:00 meeting.
    expect(
      moved({
        from: "2026-11-09",
        newRule: "RRULE:FREQ=WEEKLY;BYDAY=TU",
        oldRule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        skips: "EXDATE;TZID=America/New_York:20261130T080000",
        to: "2026-11-10",
      })
    ).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE;TZID=America/New_York:20261130T080000",
    ]);
  });

  test("moves an all-day skip as a date", () => {
    expect(
      moved({
        from: "2026-11-09",
        newRule: "RRULE:FREQ=WEEKLY;BYDAY=TU",
        oldRule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        skips: "EXDATE;VALUE=DATE:20261123",
        timed: false,
        to: "2026-11-10",
      })
    ).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU", "EXDATE;VALUE=DATE:20261124"]);
  });

  test("moves a monthly skip to its place in the new pattern", () => {
    // The 2nd Tuesday became the 3rd Wednesday: Dec 8 moves to Dec 16.
    expect(
      moved({
        from: "2026-11-10",
        newRule: "RRULE:FREQ=MONTHLY;BYDAY=3WE",
        oldRule: "RRULE:FREQ=MONTHLY;BYDAY=2TU",
        skips: "EXDATE;TZID=America/New_York:20261208T090000",
        to: "2026-11-18",
      })
    ).toEqual(["RRULE:FREQ=MONTHLY;BYDAY=3WE", "EXDATE:20261216T140000Z"]);
  });

  test("leaves a skip the new rule still meets on", () => {
    const recurrence = ["RRULE:FREQ=DAILY", "EXDATE:20261123T140000Z"];
    expect(
      moveSkippedDays({
        from: day("2026-11-09"),
        fromTime: nine,
        newRule: "RRULE:FREQ=DAILY",
        oldRule: "RRULE:FREQ=DAILY",
        recurrence,
        seriesZone: zone,
        to: day("2026-11-10"),
        toTime: nine,
      })
    ).toBe(recurrence);
  });
});
