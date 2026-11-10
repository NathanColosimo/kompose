import { describe, expect, test } from "bun:test";
import { seriesMeetsAt } from "@kompose/google-cal/recurrence-utils";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import { newRepeat } from "@kompose/google-cal/series-edits";
import { Exit } from "effect";
import { Temporal } from "temporal-polyfill";
import {
  edit,
  failure,
  fakeGoogle,
  nov16,
  occurrenceOf,
  refusalOf,
  run,
  service,
  weekly,
  zone,
} from "./google-test-fixtures";

// Entire series saves: what they write, and what they refuse because Google
// would drop or resize occurrences changed on their own.

describe("Entire series", () => {
  test("a start without an offset keeps the series' hour and skipped days", async () => {
    // Tuesdays 9:00 from Oct 6, Oct 13 skipped; renamed from the series
    // itself, its start written without an offset.
    const master: Event = {
      end: { dateTime: "2026-10-06T09:30:00-04:00", timeZone: zone },
      id: "series",
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=TU;BYHOUR=9",
        "EXDATE;TZID=America/New_York:20261013T090000",
      ],
      start: { dateTime: "2026-10-06T09:00:00-04:00", timeZone: zone },
      summary: "Planning",
    };
    const google = fakeGoogle(master);
    const exit = await run(
      edit("all", master, {
        end: { dateTime: "2026-10-06T09:30:00", timeZone: zone },
        start: { dateTime: "2026-10-06T09:00:00", timeZone: zone },
        summary: "Planning (renamed)",
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()).toHaveLength(1);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: master.recurrence,
      start: { dateTime: "2026-10-06T09:00:00-04:00", timeZone: zone },
      summary: "Planning (renamed)",
    });
  });

  test("a color the save clears is cleared", async () => {
    // The web editor's "default color" sends colorId as undefined.
    const colored: Event = { ...weekly, colorId: "5" };
    const google = fakeGoogle(colored);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(colored, "2026-11-16T09:00:00-05:00"), {
            colorId: undefined,
          })
        )
      )
    ).toBe(true);
    const [written] = google.writes();
    expect(written?.url.pathname).toEndWith("/events/series");
    expect(written?.body).not.toHaveProperty("colorId");
  });

  test("a new time that clears a color an occurrence already cleared keeps it", async () => {
    // Color 7; Nov 23 moved to 10:00 and its color cleared on its own. From
    // Nov 16, the series moves to 10:00 and clears its color: Nov 23's new
    // meeting is just as it was.
    const colored: Event = { ...weekly, colorId: "7" };
    const nov23 = {
      ...occurrenceOf(colored, "2026-11-23T09:00:00-05:00", {
        end: "2026-11-23T10:30:00-05:00",
        start: "2026-11-23T10:00:00-05:00",
      }),
      colorId: undefined,
    };
    const google = fakeGoogle(colored, [nov23]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(colored, "2026-11-16T09:00:00-05:00"), {
            colorId: undefined,
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).not.toHaveProperty("colorId");
  });

  test("a new time and title an occurrence already has the title of saves", async () => {
    // Nov 23 renamed "Review" on its own, not moved; from Nov 16 the series
    // is renamed "Review" and moved to 10:00: Nov 23's new meeting is just
    // as it was, at the new time.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        summary: "Review",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
            summary: "Review",
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({ summary: "Review" });
  });

  test("made timed at an evening hour, a deleted first meeting stays deleted", async () => {
    // Daily all day from Nov 9, Nov 9 deleted on its own; from Nov 11 made
    // 23:00 New York, the next day in UTC.
    const allDay: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { date: "2026-11-09" },
    };
    const occurrence = (day: string): Event => ({
      ...allDay,
      end: { date: Temporal.PlainDate.from(day).add({ days: 1 }).toString() },
      id: `series_${day.replaceAll("-", "")}`,
      originalStartTime: { date: day },
      recurrence: undefined,
      recurringEventId: "series",
      start: { date: day },
    });
    const google = fakeGoogle(allDay, [
      { ...occurrence("2026-11-09"), status: "cancelled" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrence("2026-11-11"), {
            end: { dateTime: "2026-11-11T23:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-11T23:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toContain(
      "EXDATE:20261110T040000Z"
    );
  });

  test("an edit to the first occurrence moves the series' date", async () => {
    // Its first meeting, Mon Nov 9, moved to Tue Nov 10 with the rule.
    const first = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00");
    const google = fakeGoogle(weekly);
    const exit = await run(
      edit("all", first, {
        end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
        start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
      start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
    });
  });

  test("an edit to the first occurrence moves the date of a series whose end comes first in its rule", async () => {
    // As below, the rule written with its UNTIL first, as another app may.
    const ending: Event = {
      ...weekly,
      recurrence: ["RRULE:UNTIL=20261231T235959Z;FREQ=WEEKLY;BYDAY=MO"],
    };
    const google = fakeGoogle(ending);
    const exit = await run(
      edit("all", occurrenceOf(ending, "2026-11-09T09:00:00-05:00"), {
        end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:UNTIL=20261231T235959Z;FREQ=WEEKLY;BYDAY=TU"],
        start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
    });
  });

  test("an edit to the first occurrence moves the date of a series with an end date", async () => {
    // Mondays until Dec 31 (an UNTIL with a time, as Google writes it);
    // its first meeting, Mon Nov 9, moved to Tue Nov 10 with the rule.
    const ending: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T235959Z"],
    };
    const google = fakeGoogle(ending);
    const exit = await run(
      edit("all", occurrenceOf(ending, "2026-11-09T09:00:00-05:00"), {
        end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T235959Z"],
        start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
    });
  });

  test("a first meeting moved past midnight keeps a deleted meeting's skip on its new place", async () => {
    // Daily at 23:00 from Nov 9, Nov 20 deleted on its own; the first
    // meeting moved to 00:30 on Nov 10 for the Entire series. Each meeting
    // moves an hour and a half on, so Nov 20's place is Nov 21 00:30, and
    // Nov 20 00:30 (Nov 19's meeting) stays on.
    const late: Event = {
      ...weekly,
      end: { dateTime: "2026-11-09T23:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { dateTime: "2026-11-09T23:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(late, [
      {
        ...occurrenceOf(late, "2026-11-20T23:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    const exit = await run(
      edit("all", occurrenceOf(late, "2026-11-09T23:00:00-05:00"), {
        end: { dateTime: "2026-11-10T01:00:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-10T00:30:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=DAILY", "EXDATE:20261121T053000Z"],
      start: { dateTime: "2026-11-10T00:30:00-05:00", timeZone: zone },
    });
  });

  test("a new evening time keeps a deleted meeting's skip on its own day", async () => {
    // Daily at 9:00 from Nov 9, Nov 20 deleted on its own; from Nov 16 the
    // series moves to 23:00: Nov 20's place is Nov 20 at 23:00.
    const daily: Event = { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] };
    const google = fakeGoogle(daily, [
      {
        ...occurrenceOf(daily, "2026-11-20T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    const exit = await run(
      edit("all", occurrenceOf(daily, "2026-11-16T09:00:00-05:00"), {
        end: { dateTime: "2026-11-16T23:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-16T23:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY",
      "EXDATE:20261121T040000Z",
    ]);
  });

  test("a first meeting moved a day on and an hour earlier keeps a deleted meeting's skip on its own day", async () => {
    // Daily at 9:00 from Nov 9, Nov 23 deleted on its own; the first
    // meeting moved to Nov 10 at 8:00. The time turns an hour back, so Nov
    // 23's place is Nov 23 at 8:00, not Nov 24.
    const google = fakeGoogle({ ...weekly, recurrence: ["RRULE:FREQ=DAILY"] }, [
      {
        ...occurrenceOf(
          { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] },
          "2026-11-23T09:00:00-05:00"
        ),
        status: "cancelled",
      },
    ]);
    const exit = await run(
      edit(
        "all",
        occurrenceOf(
          { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] },
          "2026-11-09T09:00:00-05:00"
        ),
        {
          end: { dateTime: "2026-11-10T08:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-10T08:00:00-05:00", timeZone: zone },
        }
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY",
      "EXDATE:20261123T130000Z",
    ]);
  });

  test("a first meeting moved off its rule's days keeps the series' date", async () => {
    // Mon Nov 9 moved to Tue Nov 10 at 10:00, the series' own Monday rule
    // sent back: a Tuesday start would add a meeting no rule makes, so the
    // series keeps Nov 9 and takes the new time.
    const first = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00");
    const google = fakeGoogle(weekly);
    const exit = await run(
      edit("all", first, {
        end: { dateTime: "2026-11-10T10:30:00-05:00", timeZone: zone },
        recurrence: weekly.recurrence,
        start: { dateTime: "2026-11-10T10:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: weekly.recurrence,
      start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
    });
  });

  test("a first meeting moved to a day its rule doesn't meet keeps the series' date", async () => {
    // Yearly on day 1 doesn't meet Jan 2: the series keeps Jan 1, as main
    // did.
    const yearly: Event = {
      ...weekly,
      end: { dateTime: "2027-01-01T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=YEARLY;BYYEARDAY=1"],
      start: { dateTime: "2027-01-01T09:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(yearly);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(yearly, "2027-01-01T09:00:00-05:00"), {
            end: { dateTime: "2027-01-02T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2027-01-02T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      start: { dateTime: "2027-01-01T09:00:00-05:00" },
    });
  });

  test("a daily series' first meeting moves to its new day", async () => {
    const daily: Event = { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] };
    const google = fakeGoogle(daily);
    const exit = await run(
      edit("all", occurrenceOf(daily, "2026-11-09T09:00:00-05:00"), {
        end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
    });
  });

  test("an edit to a later occurrence keeps the series' first date", async () => {
    // Nov 16 moved to 10:00: the series moves to 10:00 from Nov 9.
    const google = fakeGoogle(weekly);
    const exit = await run(
      edit("all", nov16, {
        end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
    });
  });

  test("an edit through a moved first occurrence leaves the series' times and title", async () => {
    // The first meeting was moved to Tue Nov 10 11:00 and renamed on its
    // own; the user changes only the place, for the entire series.
    const first = {
      ...occurrenceOf(weekly, "2026-11-09T09:00:00-05:00", {
        end: "2026-11-10T11:30:00-05:00",
        start: "2026-11-10T11:00:00-05:00",
      }),
      summary: "Planning (moved)",
    };
    const google = fakeGoogle(weekly, [first]);
    const exit = await run(edit("all", first, { location: "Room 2" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      location: "Room 2",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
      summary: "Planning",
    });
  });

  test("a new time for a rule that steps a whole day at a time saves", async () => {
    // Every 24 hours from Nov 9 9:00, three times: once a day.
    const everyDay: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=HOURLY;INTERVAL=24;COUNT=3"],
    };
    const google = fakeGoogle(everyDay);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", everyDay, {
            end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=HOURLY;INTERVAL=24;COUNT=3"],
      start: { dateTime: "2026-11-09T10:00:00-05:00" },
    });
  });

  test("refuses a new time in a series that meets several times a day", async () => {
    // A rule at 9:00 and one at 15:00, three days from Dec 1; Dec 2's
    // 15:00 moved to 16:00 for the entire series.
    const twice: Event = {
      ...weekly,
      end: { dateTime: "2026-12-01T09:30:00-05:00", timeZone: zone },
      recurrence: [
        "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=3",
        "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=3",
      ],
      start: { dateTime: "2026-12-01T09:00:00-05:00", timeZone: zone },
    };
    const afternoon = occurrenceOf(twice, "2026-12-02T15:00:00-05:00");
    const google = fakeGoogle(twice);
    expect(
      await refusalOf(
        edit("all", afternoon, {
          end: { dateTime: "2026-12-02T16:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-12-02T16:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({ data: { reason: "severalTimesADay" } });
    // Moved to the start's 9:00, the series' start stays where it is, but
    // the meeting's time still changes.
    expect(
      await refusalOf(
        edit("all", afternoon, {
          end: { dateTime: "2026-12-02T09:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-12-02T09:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({ data: { reason: "severalTimesADay" } });
    expect(google.writes()).toEqual([]);
    // A rename through it is fine.
    expect(
      Exit.isSuccess(await run(edit("all", afternoon, { summary: "Check-in" })))
    ).toBe(true);
  });

  test("refuses a new rule that would drop a moved occurrence", async () => {
    // Daily 9:00 from Mon Nov 30; Mon Dec 7 was moved to 14:00. Made
    // weekly on Thursdays, Google would cancel it: refused, naming it.
    const daily: Event = {
      ...weekly,
      end: { dateTime: "2026-11-30T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { dateTime: "2026-11-30T09:00:00-05:00", timeZone: zone },
    };
    const moved = occurrenceOf(daily, "2026-12-07T09:00:00-05:00", {
      end: "2026-12-07T14:30:00-05:00",
      start: "2026-12-07T14:00:00-05:00",
    });
    const thursday = occurrenceOf(daily, "2026-12-03T09:00:00-05:00");
    const google = fakeGoogle(daily, [moved]);
    expect(
      await refusalOf(
        edit("all", thursday, { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"] })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-12-07T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
        seriesOnly: true,
      },
    });
    expect(google.writes()).toEqual([]);
    // Mondays and Thursdays still meet Dec 7: saved.
    expect(
      Exit.isSuccess(
        await run(
          edit("all", thursday, {
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
          })
        )
      )
    ).toBe(true);
  });
});

describe("what Google keeps as an occurrence's own", () => {
  // Every other Monday from Nov 9: Nov 23, then Dec 7; no Nov 30.
  const everyOtherWeek = ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"];

  test("an exception just like the series (moved and moved back) holds nothing", async () => {
    const google = fakeGoogle(weekly, [
      occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
    ]);
    expect(
      Exit.isSuccess(
        await run(edit("all", nov16, { recurrence: everyOtherWeek }))
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  describe("a guest added with a new time", () => {
    // The series has a and b; the series moves to 10:00, which cancels each
    // occurrence's own changes, and c is added.
    const series: Event = {
      ...weekly,
      attendees: [{ email: "a@example.com" }, { email: "b@example.com" }],
    };
    const tenAm = {
      end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
    };

    test("is refused from an occurrence that dropped a guest on its own", async () => {
      // Nov 16 dropped b: the series is written a, b, c, and Nov 16 would
      // get b back.
      const dropped = {
        ...occurrenceOf(series, "2026-11-16T09:00:00-05:00"),
        attendees: [{ email: "a@example.com" }],
      };
      const google = fakeGoogle(series, [dropped]);
      expect(
        await refusalOf(
          edit("all", dropped, {
            ...tenAm,
            attendees: [{ email: "a@example.com" }, { email: "c@example.com" }],
          })
        )
      ).toMatchObject({
        data: {
          originalStarts: ["2026-11-16T09:00:00-05:00"],
          reason: "dropsChangedOccurrences",
        },
      });
      expect(google.writes()).toEqual([]);
    });

    test("is refused for another occurrence whose own guests are what was sent", async () => {
      // Nov 16 dropped b and sends a, c; Nov 23 has a and c of its own. The
      // series is written a, b, c, which neither has.
      const dropped = {
        ...occurrenceOf(series, "2026-11-16T09:00:00-05:00"),
        attendees: [{ email: "a@example.com" }],
      };
      const google = fakeGoogle(series, [
        dropped,
        {
          ...occurrenceOf(series, "2026-11-23T09:00:00-05:00"),
          attendees: [{ email: "a@example.com" }, { email: "c@example.com" }],
        },
      ]);
      expect(
        await refusalOf(
          edit("all", dropped, {
            ...tenAm,
            attendees: [{ email: "a@example.com" }, { email: "c@example.com" }],
          })
        )
      ).toMatchObject({
        data: {
          originalStarts: [
            "2026-11-16T09:00:00-05:00",
            "2026-11-23T09:00:00-05:00",
          ],
          reason: "dropsChangedOccurrences",
        },
      });
      expect(google.writes()).toEqual([]);
    });
  });

  test("a guest added from an occurrence leaves the guests it dropped on its own", async () => {
    // The series has a and b; Nov 16 dropped b on its own. From it, c is
    // added: the series keeps b and gains c.
    const series: Event = {
      ...weekly,
      attendees: [{ email: "a@example.com" }, { email: "b@example.com" }],
    };
    const dropped = {
      ...occurrenceOf(series, "2026-11-16T09:00:00-05:00"),
      attendees: [{ email: "a@example.com" }],
    };
    const google = fakeGoogle(series, [dropped]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", dropped, {
            attendees: [{ email: "a@example.com" }, { email: "c@example.com" }],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.attendees).toEqual([
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "c@example.com" },
    ]);
  });

  test("attachments cleared through an occurrence with its own are cleared on it too", async () => {
    // The series has A; Nov 16 has B of its own. From Nov 16, attachments
    // are cleared for the entire series.
    const series: Event = {
      ...weekly,
      attachments: [{ fileUrl: "https://example.com/a" }],
    };
    const own = {
      ...occurrenceOf(series, "2026-11-16T09:00:00-05:00"),
      attachments: [{ fileUrl: "https://example.com/b" }],
    };
    const google = fakeGoogle(series, [own]);
    expect(
      Exit.isSuccess(await run(edit("all", own, { attachments: [] })))
    ).toBe(true);
    const writes = google.writes();
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.url.searchParams.get("supportsAttachments")).toBe("true");
    }
  });

  test("a guest added keeps everyone's answers to the series", async () => {
    // I'm invited to the series; I accepted Nov 16 alone, and from it add
    // a guest: the series keeps my answer to it.
    const series: Event = {
      ...weekly,
      attendees: [{ email: "me@example.com", responseStatus: "needsAction" }],
    };
    const nov16Accepted = {
      ...occurrenceOf(series, "2026-11-16T09:00:00-05:00"),
      attendees: [{ email: "me@example.com", responseStatus: "accepted" }],
    };
    const google = fakeGoogle(series, [nov16Accepted]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16Accepted, {
            attendees: [
              { email: "me@example.com", responseStatus: "accepted" },
              { email: "b@example.com" },
            ],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.attendees).toEqual([
      { email: "me@example.com", responseStatus: "needsAction" },
      { email: "b@example.com" },
    ]);
  });

  test("an attendee's answer to one occurrence isn't a change to it", async () => {
    // A guest accepted the series and declined Nov 30.
    const guest = { email: "guest@example.com", responseStatus: "accepted" };
    const series = { ...weekly, attendees: [guest] };
    const declined = {
      ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"),
      attendees: [{ ...guest, responseStatus: "declined" }],
    };
    const google = fakeGoogle(series, [declined]);
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    expect(
      Exit.isSuccess(
        await run(edit("all", opened, { recurrence: everyOtherWeek }))
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  test("an Entire series time change is refused while an occurrence is moved", async () => {
    // Google ties Nov 23's move to its 9:00 slot, which a 10:00 series
    // no longer has.
    const google = fakeGoogle(weekly, [
      occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
        end: "2026-11-23T11:30:00-05:00",
        start: "2026-11-23T11:00:00-05:00",
      }),
    ]);
    expect(
      await refusalOf(
        edit("all", weekly, {
          end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a refusal names its occurrences by date, however Google lists them", async () => {
    // Nov 23, Nov 30 and Jan 4 renamed on their own, listed last first.
    // The series moves to 10:00 from Nov 16.
    const renamed = (iso: string) => ({
      ...occurrenceOf(weekly, iso),
      summary: "Planning (own)",
    });
    fakeGoogle(weekly, [
      renamed("2027-01-04T09:00:00-05:00"),
      renamed("2026-11-30T09:00:00-05:00"),
      renamed("2026-11-23T09:00:00-05:00"),
    ]);
    const refusal = await refusalOf(
      edit("all", nov16, {
        end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
        summary: "Planning (new)",
      })
    );
    expect(refusal).toMatchObject({
      data: {
        originalStarts: [
          "2026-11-23T09:00:00-05:00",
          "2026-11-30T09:00:00-05:00",
          "2027-01-04T09:00:00-05:00",
        ],
        reason: "dropsChangedOccurrences",
      },
      message: expect.stringContaining(
        "(Nov 23, 2026; Nov 30, 2026; Jan 4, 2027)"
      ),
    });
  });

  test("a rule with an exclusion it can't read is refused, not guessed", async () => {
    const google = fakeGoogle(weekly, [
      occurrenceOf(weekly, "2026-11-30T09:00:00-05:00", {
        end: "2026-11-30T11:30:00-05:00",
        start: "2026-11-30T11:00:00-05:00",
      }),
    ]);
    expect(
      await refusalOf(
        edit("all", nov16, {
          recurrence: ["RRULE:FREQ=DAILY", "EXRULE:FREQ=WEEKLY;BYDAY=MO"],
        })
      )
    ).toMatchObject({
      // It can't tell, and says so.
      data: { reason: "dropsChangedOccurrences", unsure: true },
      message:
        "This may undo what was changed or deleted on single occurrences (Nov 30): this series repeats in a way, made in another app, that can't be fully read here, so it wasn't saved. Save it with This and following from an occurrence after Nov 30, if there is one.",
    });
    expect(google.writes()).toEqual([]);
  });
});

describe("a series save sends only what the user changed", () => {
  // As a client may save it: the opened occurrence's own times (left as
  // they were) and the one field changed, nothing else.
  const save = (
    scope: "all" | "following",
    occurrence: Event,
    changes: Partial<CreateEvent>
  ) =>
    service().updateEvent(
      "primary",
      occurrence.id,
      { end: occurrence.end, start: occurrence.start, ...changes },
      scope,
      occurrence
    );
  const moved = {
    ...occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-17T11:30:00-05:00",
      start: "2026-11-17T11:00:00-05:00",
    }),
    description: "Bring the draft",
    summary: "Planning (moved)",
  };

  test("Entire series: the series keeps its own fields and slot", async () => {
    const google = fakeGoogle(weekly, [moved]);
    expect(
      Exit.isSuccess(await run(save("all", moved, { location: "Room 2" })))
    ).toBe(true);
    const [written] = google.writes();
    expect(written?.body).toMatchObject({
      end: { dateTime: "2026-11-09T09:30:00-05:00", timeZone: zone },
      location: "Room 2",
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
      summary: "Planning",
    });
    expect(written?.body).not.toHaveProperty("description");
  });
});

describe("edges a series write has to tell apart", () => {
  test("an Entire series made all day is refused while an occurrence is moved", async () => {
    // Google ties the moves to the 9:00 slots an all-day series hasn't
    // got, the first meeting's too.
    const movedFirst = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00", {
      end: "2026-11-09T11:30:00-05:00",
      start: "2026-11-09T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [movedFirst]);
    expect(
      await refusalOf(
        edit("all", weekly, {
          end: { date: "2026-11-10" },
          start: { date: "2026-11-09" },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-09T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("clearing a field the series has clears it for the series", async () => {
    const noted = { ...weekly, description: "Agenda in the doc" };
    const opened = occurrenceOf(noted, "2026-11-16T09:00:00-05:00");
    const google = fakeGoogle(noted);
    expect(
      Exit.isSuccess(await run(edit("all", opened, { description: "" })))
    ).toBe(true);
    expect(google.writes()[0]?.body?.description).toBe("");
  });
});

describe("the opened occurrence takes the user's change", () => {
  test("an occurrence without its own value isn't written on its own", async () => {
    // Nov 16 is the series' own: renaming the series renames it.
    const google = fakeGoogle(weekly);
    expect(
      Exit.isSuccess(await run(edit("all", nov16, { summary: "New series" })))
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });
});

describe("the opened occurrence through an Entire series save", () => {
  // Nov 23 was moved to 11:00 and renamed on its own.
  const special = {
    ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
      end: "2026-11-23T11:30:00-05:00",
      start: "2026-11-23T11:00:00-05:00",
    }),
    summary: "Special",
  };

  test("from a later moved and renamed one, a new title reaches it and its move stays", async () => {
    const google = fakeGoogle(weekly, [special]);
    expect(
      Exit.isSuccess(await run(edit("all", special, { summary: "New series" })))
    ).toBe(true);
    const [series, opened] = google.writes();
    expect(series?.body).toMatchObject({
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
      summary: "New series",
    });
    expect(opened?.url.pathname).toEndWith(`/events/${special.id}`);
    expect(opened?.body).toMatchObject({
      start: { dateTime: "2026-11-23T11:00:00-05:00", timeZone: zone },
      summary: "New series",
    });
  });

  test("a new title and length both reach a renamed one", async () => {
    // Nov 16 was only renamed; the user renames the series and makes it
    // an hour long, from there.
    const renamed = { ...nov16, summary: "Planning (Nov)" };
    const google = fakeGoogle(weekly, [renamed]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", renamed, {
            end: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
            summary: "New series",
          })
        )
      )
    ).toBe(true);
    const [series, opened] = google.writes();
    expect(series?.body).toMatchObject({
      end: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
      summary: "New series",
    });
    expect(opened?.body).toMatchObject({
      end: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
      summary: "New series",
    });
  });

  test("when the occurrence can't be written, the series is saved and the failure returned", async () => {
    const google = fakeGoogle(weekly, [special], (request) =>
      request.method === "PUT" && request.url.pathname.endsWith(special.id)
        ? failure(400)
        : undefined
    );
    expect(
      Exit.isFailure(await run(edit("all", special, { summary: "New series" })))
    ).toBe(true);
    const [series, opened] = google.writes();
    expect(series?.url.pathname).toEndWith("/events/series");
    expect(series?.body?.summary).toBe("New series");
    expect(opened?.url.pathname).toEndWith(`/events/${special.id}`);
  });
});

describe("Entire series through an occurrence keeps that occurrence's day", () => {
  // Daily 9:00 from Nov 9; Nov 16 was renamed on its own.
  const daily: Event = { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] };
  const own = {
    ...occurrenceOf(daily, "2026-11-16T09:00:00-05:00"),
    summary: "Own",
  };

  test("a drag to another day moves nothing on its own", async () => {
    const google = fakeGoogle(daily, [own]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", own, {
            end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const writes = google.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
    });
  });

  test("a new length dragged to another day reaches it on its own day", async () => {
    const google = fakeGoogle(daily, [own]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", own, {
            end: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [series, opened] = google.writes();
    expect(series?.body).toMatchObject({
      end: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
    });
    expect(opened?.body).toMatchObject({
      end: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
      summary: "Own",
    });
  });
});

describe("Entire series through an all-day occurrence keeps that occurrence's day", () => {
  // Daily all day from Nov 9; Nov 16 was renamed on its own.
  const allDay: Event = {
    ...weekly,
    end: { date: "2026-11-10" },
    recurrence: ["RRULE:FREQ=DAILY"],
    start: { date: "2026-11-09" },
  };
  const own: Event = {
    ...allDay,
    end: { date: "2026-11-17" },
    id: "series_20261116",
    originalStartTime: { date: "2026-11-16" },
    recurrence: undefined,
    recurringEventId: "series",
    start: { date: "2026-11-16" },
    summary: "Own",
  };

  test("a drag to another day moves nothing on its own", async () => {
    const google = fakeGoogle(allDay, [own]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", own, {
            end: { date: "2026-11-18" },
            start: { date: "2026-11-17" },
          })
        )
      )
    ).toBe(true);
    const writes = google.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({ start: { date: "2026-11-09" } });
  });

  test("a new span of days dragged to another day reaches it on its own day", async () => {
    const google = fakeGoogle(allDay, [own]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", own, {
            end: { date: "2026-11-19" },
            start: { date: "2026-11-17" },
          })
        )
      )
    ).toBe(true);
    const [series, opened] = google.writes();
    expect(series?.body).toMatchObject({
      end: { date: "2026-11-11" },
      start: { date: "2026-11-09" },
    });
    expect(opened?.body).toMatchObject({
      end: { date: "2026-11-18" },
      start: { date: "2026-11-16" },
      summary: "Own",
    });
  });
});

describe("Entire series start and length changes, as Google applies them", () => {
  // Google cancels every exception when the series' start moves (its time,
  // its day or both), and gives every exception the series' new length when
  // only the end moves.
  const renamed = (original: string): Event => ({
    ...occurrenceOf(weekly, original),
    summary: "Planning (renamed)",
  });

  test("moving the start's day is refused while any occurrence has changes of its own", async () => {
    // The first meeting moved a week earlier, same weekday and time: the
    // rule still meets Nov 23, but Google cancels its exception.
    const first = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00");
    const google = fakeGoogle(weekly, [renamed("2026-11-23T09:00:00-05:00")]);
    expect(
      await refusalOf(
        edit("all", first, {
          end: { dateTime: "2026-11-02T09:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-02T09:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("moving the first meeting's day keeps a deleted occurrence deleted", async () => {
    // Daily from Mon Nov 9, Nov 12 deleted on its own; the first meeting
    // moves to Tue Nov 10. Google brings Nov 12 back unless it's skipped.
    const daily: Event = { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] };
    const google = fakeGoogle(daily, [
      {
        ...occurrenceOf(daily, "2026-11-12T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(daily, "2026-11-09T09:00:00-05:00"), {
            end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=DAILY", "EXDATE:20261112T140000Z"],
      start: { dateTime: "2026-11-10T09:00:00-05:00" },
    });
  });

  test("a new time set from an occurrence moved on its own saves", async () => {
    // Nov 16 moved to 11:00 on its own; from it, the series moves to 10:00.
    // Its own time is the one the edit replaces: the series is written
    // once, and Nov 16 meets at 10:00 with it.
    const moved = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-16T11:30:00-05:00",
      start: "2026-11-16T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", moved, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
    expect(google.writes()[0]?.body).toMatchObject({
      start: { dateTime: "2026-11-09T10:00:00-05:00" },
    });
    // Renamed on its own too, the new time would cost it its title.
    fakeGoogle(weekly, [{ ...moved, summary: "Planning (moved)" }]);
    expect(
      await refusalOf(
        edit(
          "all",
          { ...moved, summary: "Planning (moved)" },
          {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          }
        )
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-16T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
  });

  test("made all day, a deleted occurrence stays deleted on its date", async () => {
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", weekly, {
            end: { date: "2026-11-10" },
            start: { date: "2026-11-09" },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;VALUE=DATE:20261123",
    ]);
  });

  test("a new time and title an occurrence already has on its own save", async () => {
    // Nov 23 moved to 10:00 and renamed "Review" on its own; from Nov 16,
    // the series moves to 10:00 and is renamed "Review": its meeting there
    // is the same.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
          end: "2026-11-23T10:30:00-05:00",
          start: "2026-11-23T10:00:00-05:00",
        }),
        summary: "Review",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
            summary: "Review",
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      start: { dateTime: "2026-11-09T10:00:00-05:00" },
      summary: "Review",
    });
  });

  test("a new time from an occurrence moved to another day on its own is refused", async () => {
    // Nov 16 moved to Tue Nov 17 11:00 on its own; from it, 10:00. Google
    // would put it back on Monday.
    const moved = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-17T11:30:00-05:00",
      start: "2026-11-17T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved]);
    expect(
      await refusalOf(
        edit("all", moved, {
          end: { dateTime: "2026-11-17T10:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-17T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-16T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a new time from a first meeting moved to another day keeps the series' date", async () => {
    // Daily from Nov 9; Nov 9 moved to Nov 10 11:00 on its own; from it,
    // only the time changes, to 10:00. The series keeps Nov 9.
    const daily: Event = { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] };
    const moved = occurrenceOf(daily, "2026-11-09T09:00:00-05:00", {
      end: "2026-11-10T11:30:00-05:00",
      start: "2026-11-10T11:00:00-05:00",
    });
    const google = fakeGoogle(daily, [moved]);
    // Its own day would be lost, so it's refused; the series' start never
    // moves to Nov 10, which would drop the Nov 9 meeting.
    expect(
      await refusalOf(
        edit("all", moved, {
          end: { dateTime: "2026-11-10T10:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-10T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-09T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("made timed, a deleted all-day occurrence is skipped on its own date", async () => {
    // Daily all day from Nov 9, Nov 23 deleted; made 23:00 New York.
    const allDay: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { date: "2026-11-09" },
    };
    const google = fakeGoogle(allDay, [
      {
        ...allDay,
        end: { date: "2026-11-24" },
        id: "series_20261123",
        originalStartTime: { date: "2026-11-23" },
        recurrence: undefined,
        recurringEventId: "series",
        start: { date: "2026-11-23" },
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", allDay, {
            end: { dateTime: "2026-11-09T23:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-09T23:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=DAILY",
      "EXDATE:20261124T040000Z",
    ]);
  });

  test("a first meeting's day move under a monthly rule is refused while one is deleted", async () => {
    // Monthly on the 9th from Nov 9, Dec 9 deleted on its own; the first
    // meeting moves to Nov 10, so every meeting moves to the 10th and Dec
    // 9's skip would leave Dec 10 to come back.
    const monthly: Event = { ...weekly, recurrence: ["RRULE:FREQ=MONTHLY"] };
    const google = fakeGoogle(monthly, [
      {
        ...occurrenceOf(monthly, "2026-12-09T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      await refusalOf(
        edit("all", occurrenceOf(monthly, "2026-11-09T09:00:00-05:00"), {
          end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-12-09T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a first meeting's day move under a monthly rule is refused while one is skipped in the rule", async () => {
    // Monthly on the 9th from Nov 9, Dec 9 skipped in the rule; the first
    // meeting moves to Nov 10, so Dec 9's skip would leave Dec 10 to come
    // back.
    const monthly: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=MONTHLY", "EXDATE:20261209T140000Z"],
    };
    const google = fakeGoogle(monthly, []);
    expect(
      await refusalOf(
        edit("all", occurrenceOf(monthly, "2026-11-09T09:00:00-05:00"), {
          end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-12-09T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a skip in the rule the client moved with a day move is saved", async () => {
    // Mondays from Nov 9, Nov 30 skipped; moved to Tuesdays from Nov 10,
    // the client sends the skip on Tue Dec 1.
    const mondays: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261130T140000Z"],
    };
    const google = fakeGoogle(mondays, []);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(mondays, "2026-11-09T09:00:00-05:00"), {
            end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
            recurrence: [
              "RRULE:FREQ=WEEKLY;BYDAY=TU",
              "EXDATE:20261201T140000Z",
            ],
            start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toContain(
      "EXDATE:20261201T140000Z"
    );
  });

  test("reads every page of the series' exceptions", async () => {
    // Google lists Nov 23, renamed on its own, on a second page.
    const onSecondPage = {
      ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
      summary: "Planning (renamed)",
    };
    fakeGoogle(weekly, [], (request) => {
      if (!request.url.pathname.endsWith("/events")) {
        return;
      }
      return request.url.searchParams.get("pageToken") === "2"
        ? { items: [onSecondPage] }
        : { items: [weekly], nextPageToken: "2" };
    });
    expect(
      await refusalOf(
        edit("all", weekly, {
          end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
  });

  test("a new time and repeat that drop the opened occurrence's place are refused", async () => {
    // Nov 16 moved to 11:00 on its own; from it, 10:00 on Tuesdays: no
    // Monday Nov 16 meeting is left in its place.
    const moved = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-16T11:30:00-05:00",
      start: "2026-11-16T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved]);
    expect(
      await refusalOf(
        edit("all", moved, {
          end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
          start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-16T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a deleted occurrence past a new end isn't counted lost", async () => {
    // Nov 23 deleted; the series moves to 10:00 and ends after two.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", weekly, {
            end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2"],
            start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  test("a first meeting made all day on a new day is written as a date", async () => {
    // The form keeps the old date-time beside the new date.
    const daily: Event = { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] };
    const google = fakeGoogle(daily);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(daily, "2026-11-09T09:00:00-05:00"), {
            end: {
              date: "2026-11-11",
              dateTime: "2026-11-09T09:30:00-05:00",
              timeZone: zone,
            },
            start: {
              date: "2026-11-10",
              dateTime: "2026-11-09T09:00:00-05:00",
              timeZone: zone,
            },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.start).toEqual({ date: "2026-11-10" });
  });

  test("a new start the save skips, from a first meeting moved on its own, is refused", async () => {
    // Nov 9 moved to 11:00 on its own; from it, 10:00 with Nov 9 10:00
    // skipped: nothing is left in its place.
    const first = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00", {
      end: "2026-11-09T11:30:00-05:00",
      start: "2026-11-09T11:00:00-05:00",
    });
    fakeGoogle(weekly, [first]);
    expect(
      await refusalOf(
        edit("all", first, {
          end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261109T150000Z"],
          start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({ data: { reason: "dropsChangedOccurrences" } });
  });

  test.each([
    [
      "deleted on its own",
      [],
      {
        ...occurrenceOf(weekly, "2026-11-11T09:00:00-05:00"),
        status: "cancelled",
      },
    ],
    ["skipped in the rule", ["EXDATE:20261111T140000Z"], null],
  ])(
    "a first meeting moved onto a day whose meeting was %s keeps it",
    async (_how, skips, exception) => {
      // Mondays and Wednesdays from Nov 9; Wed Nov 11's meeting is gone. The
      // first meeting moves to Nov 11 for the Entire series: it stays there.
      const series: Event = {
        ...weekly,
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE", ...skips],
      };
      const google = fakeGoogle(series, exception ? [exception] : []);
      expect(
        Exit.isSuccess(
          await run(
            edit("all", series, {
              end: { dateTime: "2026-11-11T09:30:00-05:00", timeZone: zone },
              start: { dateTime: "2026-11-11T09:00:00-05:00", timeZone: zone },
            })
          )
        )
      ).toBe(true);
      expect(google.writes()[0]?.body).toMatchObject({
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
        start: { dateTime: "2026-11-11T09:00:00-05:00" },
      });
    }
  );

  test("a deleted first meeting stays deleted at the series' new time", async () => {
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-09T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261109T150000Z",
    ]);
  });

  test("a first meeting moved on its own to one day, then to another, saves", async () => {
    // Daily from Nov 9; Nov 9 moved to Nov 10 11:00 on its own; from it,
    // moved to Nov 11 11:00 for the Entire series.
    const daily: Event = { ...weekly, recurrence: ["RRULE:FREQ=DAILY"] };
    const moved = occurrenceOf(daily, "2026-11-09T09:00:00-05:00", {
      end: "2026-11-10T11:30:00-05:00",
      start: "2026-11-10T11:00:00-05:00",
    });
    const google = fakeGoogle(daily, [moved]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", moved, {
            end: { dateTime: "2026-11-11T11:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-11T11:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.start).toMatchObject({
      dateTime: "2026-11-11T11:00:00-05:00",
    });
  });

  test("a series that meets several times a day made all day is refused", async () => {
    const twice: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=DAILY;BYHOUR=9", "RRULE:FREQ=DAILY;BYHOUR=15"],
    };
    const google = fakeGoogle(twice);
    expect(
      await refusalOf(
        edit("all", twice, {
          end: { date: "2026-11-10" },
          start: { date: "2026-11-09" },
        })
      )
    ).toMatchObject({ data: { reason: "severalTimesADay" } });
    expect(google.writes()).toEqual([]);
  });

  test("a new time and end that drop the opened occurrence are refused", async () => {
    // Nov 23 moved to 11:00 on its own; from it, 12:00 and twice only: the
    // series ends Nov 16, before it.
    const moved = occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
      end: "2026-11-23T11:30:00-05:00",
      start: "2026-11-23T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved]);
    expect(
      await refusalOf(
        edit("all", moved, {
          end: { dateTime: "2026-11-23T12:30:00-05:00", timeZone: zone },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2"],
          start: { dateTime: "2026-11-23T12:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a new repeat sent alone keeps the series' skips", async () => {
    // Nov 23 skipped; the repeat becomes Mondays and Wednesdays, sent alone.
    const skipped: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20261123T140000Z"],
    };
    const google = fakeGoogle(skipped);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", skipped, {
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      "EXDATE:20261123T140000Z",
    ]);
  });

  test("an all-day series made timed from a form that keeps the date saves the time", async () => {
    const allDay: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { date: "2026-11-09" },
    };
    const opened = {
      ...allDay,
      end: { date: "2026-11-17" },
      id: "series_20261116",
      originalStartTime: { date: "2026-11-16" },
      recurrence: undefined,
      recurringEventId: "series",
      start: { date: "2026-11-16" },
    };
    const google = fakeGoogle(allDay, [opened]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", opened, {
            end: {
              date: "2026-11-17",
              dateTime: "2026-11-16T10:00:00-05:00",
              timeZone: zone,
            },
            start: {
              date: "2026-11-16",
              dateTime: "2026-11-16T09:00:00-05:00",
              timeZone: zone,
            },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.start).toMatchObject({
      dateTime: "2026-11-09T09:00:00-05:00",
    });
  });

  test("a new time keeps a deleted occurrence deleted under a yearly day-of-year rule", async () => {
    // Yearly on day 1, the 2028 meeting deleted; moved to 10:00: it stays
    // deleted at 10:00.
    const yearly: Event = {
      ...weekly,
      end: { dateTime: "2027-01-01T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=YEARLY;BYYEARDAY=1"],
      start: { dateTime: "2027-01-01T09:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(yearly, [
      {
        ...occurrenceOf(yearly, "2028-01-01T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", yearly, {
            end: { dateTime: "2027-01-01T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2027-01-01T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;BYYEARDAY=1",
      "EXDATE:20280101T150000Z",
    ]);
  });

  test("a new time keeps a deleted occurrence deleted at it", async () => {
    // Nov 23 deleted on its own; the series moves to 10:00.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", weekly, {
            end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261123T150000Z",
    ]);
  });

  test("a new time and length an occurrence was moved to, at the series' length, saves", async () => {
    // Nov 23 moved to 10:00 on its own, still half an hour; the series moves
    // to 10:00 and an hour: Nov 23 keeps its start and takes the length.
    const google = fakeGoogle(weekly, [
      occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
        end: "2026-11-23T10:30:00-05:00",
        start: "2026-11-23T10:00:00-05:00",
      }),
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T11:00:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  test("a first meeting's day move is refused while an all-day occurrence has its own length", async () => {
    // Daily all day from Nov 9; Nov 12 runs through Nov 14 on its own. The
    // first meeting moves to Nov 8: Google would give Nov 12 back one day.
    const allDay: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      recurrence: ["RRULE:FREQ=DAILY"],
      start: { date: "2026-11-09" },
    };
    const occurrence = (day: string, end: string): Event => ({
      ...allDay,
      end: { date: end },
      id: `series_${day.replaceAll("-", "")}`,
      originalStartTime: { date: day },
      recurrence: undefined,
      recurringEventId: "series",
      start: { date: day },
    });
    const google = fakeGoogle(allDay, [occurrence("2026-11-12", "2026-11-15")]);
    expect(
      await refusalOf(
        edit("all", occurrence("2026-11-09", "2026-11-10"), {
          end: { date: "2026-11-09" },
          start: { date: "2026-11-08" },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-12"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a COUNT running past fifty years still tells an early occurrence is kept", async () => {
    // Yearly from Nov 9 2026, eighty times; Nov 9 2027 renamed on its own.
    // Made seventy-nine from the first meeting, 2027 still meets.
    const yearly: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=YEARLY;COUNT=80"],
    };
    const google = fakeGoogle(yearly, [
      {
        ...occurrenceOf(yearly, "2027-11-09T09:00:00-05:00"),
        summary: "Planning (2027)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(yearly, "2026-11-09T09:00:00-05:00"), {
            recurrence: ["RRULE:FREQ=YEARLY;COUNT=79"],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=YEARLY;COUNT=79",
    ]);
  });

  test("a new time an occurrence was already moved to on its own saves", async () => {
    // Nov 23 moved to 10:00 on its own; the series moves to 10:00. Google
    // cancels Nov 23's exception, and the series' 10:00 meeting is the same.
    const google = fakeGoogle(weekly, [
      occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
        end: "2026-11-23T10:30:00-05:00",
        start: "2026-11-23T10:00:00-05:00",
      }),
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      start: { dateTime: "2026-11-09T10:00:00-05:00" },
    });
    // Moved to 11:00 instead, it would lose its own time: refused.
    fakeGoogle(weekly, [
      occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
        end: "2026-11-23T11:30:00-05:00",
        start: "2026-11-23T11:00:00-05:00",
      }),
    ]);
    expect(
      await refusalOf(
        edit("all", nov16, {
          end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({ data: { reason: "dropsChangedOccurrences" } });
  });

  test("made all day, an occurrence already all day on its own saves", async () => {
    // Nov 23 made all day on its own; the whole series is made all day.
    // Google cancels Nov 23's exception, and the series' Nov 23 is the same.
    const nov23 = occurrenceOf(weekly, "2026-11-23T09:00:00-05:00");
    const allDayOn = (end: string): Event => ({
      ...nov23,
      end: { date: end },
      start: { date: "2026-11-23" },
    });
    const google = fakeGoogle(weekly, [allDayOn("2026-11-24")]);
    const madeAllDay = () =>
      edit("all", nov16, {
        end: { date: "2026-11-17" },
        start: { date: "2026-11-16" },
      });
    expect(Exit.isSuccess(await run(madeAllDay()))).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      start: { date: "2026-11-09" },
    });
    // Two days long on its own, it would lose its second day: refused.
    fakeGoogle(weekly, [allDayOn("2026-11-25")]);
    expect(await refusalOf(madeAllDay())).toMatchObject({
      data: { reason: "dropsChangedOccurrences" },
    });
  });

  test("made timed, an occurrence already at that time on its own saves", async () => {
    // Mondays all day; Nov 23 set to 10:00 on its own; the whole series
    // is set to 10:00.
    const allDay: Event = {
      ...weekly,
      end: { date: "2026-11-10" },
      start: { date: "2026-11-09" },
    };
    const onDay = (day: string, times?: Pick<Event, "end" | "start">) => ({
      ...allDay,
      end: { date: Temporal.PlainDate.from(day).add({ days: 1 }).toString() },
      id: `series_${day.replace(/-/g, "")}`,
      originalStartTime: { date: day },
      recurrence: undefined,
      recurringEventId: "series",
      start: { date: day },
      ...times,
    });
    const at = (day: string, time: string) => ({
      dateTime: `${day}T${time}:00-05:00`,
      timeZone: zone,
    });
    const nov23At = (start: string) =>
      onDay("2026-11-23", {
        end: at("2026-11-23", "10:30"),
        start: at("2026-11-23", start),
      });
    const google = fakeGoogle(allDay, [nov23At("10:00")]);
    const madeTimed = () =>
      edit("all", onDay("2026-11-16"), {
        end: at("2026-11-16", "10:30"),
        start: at("2026-11-16", "10:00"),
      });
    expect(Exit.isSuccess(await run(madeTimed()))).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      start: { dateTime: "2026-11-09T10:00:00-05:00" },
    });
    // At 9:30 on its own instead, it would lose its own time: refused.
    fakeGoogle(allDay, [nov23At("09:30")]);
    expect(await refusalOf(madeTimed())).toMatchObject({
      data: { reason: "dropsChangedOccurrences" },
    });
  });

  describe("Repeat: None leaves the first meeting alone", () => {
    const nov9 = "2026-11-09T09:00:00-05:00";
    const at = (time: string) => ({
      dateTime: `2026-11-10T${time}:00-05:00`,
      timeZone: zone,
    });
    // Nov 9, the first meeting, renamed "Kickoff" on its own.
    const kickoff = { ...occurrenceOf(weekly, nov9), summary: "Kickoff" };

    test.each([
      ["from it", kickoff],
      ["from another", nov16],
    ])("keeping its own title, saved %s", async (_from, opened) => {
      const google = fakeGoogle(weekly, [kickoff]);
      expect(
        Exit.isSuccess(await run(edit("all", opened, { recurrence: [] })))
      ).toBe(true);
      expect(google.writes()).toMatchObject([
        {
          body: {
            recurrence: [],
            start: { dateTime: nov9 },
            summary: "Kickoff",
          },
        },
      ]);
    });

    test("keeping it tentative when it was marked so on its own", async () => {
      const tentative = {
        ...occurrenceOf(weekly, nov9),
        status: "tentative",
      };
      const google = fakeGoogle({ ...weekly, status: "confirmed" }, [
        tentative,
      ]);
      expect(
        Exit.isSuccess(await run(edit("all", nov16, { recurrence: [] })))
      ).toBe(true);
      expect(google.writes()).toMatchObject([
        { body: { recurrence: [], status: "tentative" } },
      ]);
    });

    test("keeping the meeting link it dropped on its own dropped", async () => {
      const meet = {
        conferenceId: "abc-defg-hij",
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com/abc" },
        ],
      };
      const google = fakeGoogle({ ...weekly, conferenceData: meet }, [
        { ...occurrenceOf(weekly, nov9), conferenceData: undefined },
      ]);
      expect(
        Exit.isSuccess(await run(edit("all", nov16, { recurrence: [] })))
      ).toBe(true);
      const [written] = google.writes();
      expect(written?.url.searchParams.get("conferenceDataVersion")).toBe("1");
      expect(written?.body).not.toHaveProperty("conferenceData");
    });

    test("asking Google to write its own attachment", async () => {
      const google = fakeGoogle(weekly, [
        {
          ...occurrenceOf(weekly, nov9),
          attachments: [{ fileUrl: "https://example.com/agenda" }],
        },
      ]);
      expect(
        Exit.isSuccess(await run(edit("all", nov16, { recurrence: [] })))
      ).toBe(true);
      const [written] = google.writes();
      expect(written?.url.searchParams.get("supportsAttachments")).toBe("true");
      expect(written?.body).toMatchObject({
        attachments: [{ fileUrl: "https://example.com/agenda" }],
      });
    });

    test("a title the save sets is the event's", async () => {
      const google = fakeGoogle(weekly, [kickoff]);
      expect(
        Exit.isSuccess(
          await run(edit("all", kickoff, { recurrence: [], summary: "Retro" }))
        )
      ).toBe(true);
      expect(google.writes()).toMatchObject([{ body: { summary: "Retro" } }]);
    });

    test("keeping its own day and time", async () => {
      // Nov 9 moved to Tue Nov 10 11:00 on its own.
      const moved = occurrenceOf(weekly, nov9, {
        end: "2026-11-10T11:30:00-05:00",
        start: "2026-11-10T11:00:00-05:00",
      });
      const google = fakeGoogle(weekly, [moved]);
      expect(
        Exit.isSuccess(await run(edit("all", nov16, { recurrence: [] })))
      ).toBe(true);
      expect(google.writes()).toMatchObject([
        { body: { end: at("11:30"), recurrence: [], start: at("11:00") } },
      ]);
      // A new time for the series would take its own: refused.
      fakeGoogle(weekly, [moved]);
      expect(
        await refusalOf(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            recurrence: [],
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      ).toMatchObject({
        data: { originalStarts: [nov9], reason: "dropsChangedOccurrences" },
      });
    });

    test.each([
      [
        "it was deleted",
        { ...occurrenceOf(weekly, nov9), status: "cancelled" },
      ],
      [
        "a later one was changed",
        {
          ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
          summary: "Own",
        },
      ],
    ])("is refused when %s on its own", async (_case, exception) => {
      const google = fakeGoogle(weekly, [exception]);
      expect(
        await refusalOf(edit("all", nov16, { recurrence: [] }))
      ).toMatchObject({
        data: {
          originalStarts: [exception.originalStartTime?.dateTime],
          reason: "dropsChangedOccurrences",
        },
      });
      expect(google.writes()).toEqual([]);
    });

    test("is refused when it was skipped in the rule", async () => {
      const google = fakeGoogle(
        {
          ...weekly,
          recurrence: [...(weekly.recurrence ?? []), "EXDATE:20261109T140000Z"],
        },
        []
      );
      expect(
        await refusalOf(edit("all", nov16, { recurrence: [] }))
      ).toMatchObject({
        data: { originalStarts: [nov9], reason: "dropsChangedOccurrences" },
      });
      expect(google.writes()).toEqual([]);
    });

    test("is refused, unsure, when an exclusion rule may drop it", async () => {
      // Daily, with Mondays excluded (Nov 9, the start, is one).
      const google = fakeGoogle(
        {
          ...weekly,
          recurrence: ["RRULE:FREQ=DAILY", "EXRULE:FREQ=WEEKLY;BYDAY=MO"],
        },
        []
      );
      expect(
        await refusalOf(
          edit("all", occurrenceOf(weekly, "2026-11-10T09:00:00-05:00"), {
            recurrence: [],
          })
        )
      ).toMatchObject({
        data: {
          originalStarts: [nov9],
          reason: "dropsChangedOccurrences",
          unsure: true,
        },
      });
      expect(google.writes()).toEqual([]);
    });

    test("keeping a length of its own", async () => {
      // Nov 9 made 9:00-10:00 on its own (the series is half an hour).
      const longer = occurrenceOf(weekly, nov9, {
        end: "2026-11-09T10:00:00-05:00",
        start: nov9,
      });
      const google = fakeGoogle(weekly, [longer]);
      expect(
        Exit.isSuccess(await run(edit("all", nov16, { recurrence: [] })))
      ).toBe(true);
      expect(google.writes()).toMatchObject([
        {
          body: {
            end: { dateTime: "2026-11-09T10:00:00-05:00" },
            recurrence: [],
            start: { dateTime: nov9 },
          },
        },
      ]);
    });

    test("writes no skips", async () => {
      const google = fakeGoogle(
        {
          ...weekly,
          recurrence: [...(weekly.recurrence ?? []), "EXDATE:20261123T140000Z"],
        },
        []
      );
      expect(
        Exit.isSuccess(await run(edit("all", nov16, { recurrence: [] })))
      ).toBe(true);
      expect(google.writes()[0]?.body?.recurrence).toEqual([]);
    });
  });

  test("new notes leave an occurrence's own times in a repeated hour as they are", async () => {
    // Nov 1 moved on its own to the second 1:30-2:00 that night (clocks go
    // back at 2:00); new notes for the Entire series through it.
    const sundays: Event = {
      ...weekly,
      end: { dateTime: "2026-10-25T09:30:00-04:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"],
      start: { dateTime: "2026-10-25T09:00:00-04:00", timeZone: zone },
    };
    const moved = occurrenceOf(sundays, "2026-11-01T09:00:00-05:00", {
      end: "2026-11-01T02:00:00-05:00",
      start: "2026-11-01T01:30:00-05:00",
    });
    const google = fakeGoogle(sundays, [moved]);
    expect(
      Exit.isSuccess(
        await run(edit("all", moved, { description: "Bring the draft" }))
      )
    ).toBe(true);
    // Only the series is written: Nov 1 keeps its own times untouched.
    expect(google.writes()).toHaveLength(1);
  });

  test("guests listed in another order are no change of its own", async () => {
    const guests = [{ email: "a@example.com" }, { email: "b@example.com" }];
    const series: Event = { ...weekly, attendees: guests };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-23T09:00:00-05:00"),
        attendees: [...guests].reverse(),
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  test("a first meeting moved on its own is refused, unsure, where an exclusion rule may drop its place", async () => {
    // Daily from Tue Nov 10, Mondays excluded; Nov 10 moved to 11:00 on
    // its own, then moved to Mon Nov 16 11:00 for the Entire series.
    const series: Event = {
      ...weekly,
      end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=DAILY", "EXRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
    };
    const first = occurrenceOf(series, "2026-11-10T09:00:00-05:00", {
      end: "2026-11-10T11:30:00-05:00",
      start: "2026-11-10T11:00:00-05:00",
    });
    const google = fakeGoogle(series, [first]);
    expect(
      await refusalOf(
        edit("all", first, {
          end: { dateTime: "2026-11-16T11:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-16T11:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: { reason: "dropsChangedOccurrences", unsure: true },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a rule sent without the series' skip, otherwise its own, isn't a new rule", async () => {
    // Mondays in some weeks of the year, Nov 16 skipped (written with its zone), Nov 30
    // renamed on its own; a new title for the Entire series from Dec 7,
    // sent with the rule alone.
    const rule = "RRULE:FREQ=WEEKLY;BYDAY=MO;BYWEEKNO=1,2,3,47,48,49,50";
    const series: Event = {
      ...weekly,
      recurrence: [rule, "EXDATE;TZID=America/New_York:20261116T090000"],
    };
    const google = fakeGoogle(series, [
      { ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"), summary: "Own" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(series, "2026-12-07T09:00:00-05:00"), {
            recurrence: [rule],
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      rule,
      "EXDATE:20261116T140000Z",
    ]);
  });

  test("a new repeat at a new time isn't refused for a deleted occurrence", async () => {
    // Nov 23 deleted on its own; Mondays become Tuesdays at 10:00, as the
    // same new repeat at the old time saves: no Monday meets to come back.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        status: "cancelled",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  test("an occurrence Google already detached isn't at stake", async () => {
    // The series moved from 9:00 to 10:00 before; Nov 23, renamed at 9:00,
    // stays listed at a slot the series no longer has. Moving the series
    // to 11:00 costs it nothing.
    const atTen: Event = {
      ...weekly,
      end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
    };
    const google = fakeGoogle(atTen, [
      { ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"), summary: "Own" },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(atTen, "2026-11-16T10:00:00-05:00"), {
            end: { dateTime: "2026-11-16T11:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T11:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  test("an occurrence detached when the series was made timed isn't at stake", async () => {
    // The series was all day, then made 9:00; Google still lists Nov 23,
    // renamed while all day, at its date. Moving to 10:00 costs it nothing.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        end: { date: "2026-11-24" },
        originalStartTime: { date: "2026-11-23" },
        start: { date: "2026-11-23" },
        summary: "Own",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  test("a field Google lists at its default on one occurrence isn't a change", async () => {
    // Nov 23 comes back with visibility and transparency at their
    // defaults, which the series leaves out; the series moves to 10:00.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        guestsCanInviteOthers: true,
        transparency: "opaque",
        visibility: "default",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });

  test("a reminder set on one occurrence is a change of its own", async () => {
    // Nov 23 has only its own five-minute reminder; the series moves to
    // 10:00, which Google would cancel it for.
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"),
        reminders: {
          overrides: [{ method: "popup", minutes: 5 }],
          useDefault: false,
        },
      },
    ]);
    expect(
      await refusalOf(
        edit("all", weekly, {
          end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
    });
    expect(google.writes()).toEqual([]);
  });

  test("moving the start's time is refused for a renamed occurrence too", async () => {
    const google = fakeGoogle(weekly, [renamed("2026-11-23T09:00:00-05:00")]);
    expect(
      await refusalOf(
        edit("all", weekly, {
          end: { dateTime: "2026-11-09T10:30:00-05:00", timeZone: zone },
          start: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
        })
      )
    ).toEqual({
      code: "BAD_REQUEST",
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
      // A new time one occurrence can take.
      message:
        "This would undo what was changed or deleted on single occurrences (Nov 23), so it wasn't saved. Save it for this occurrence only, or with This and following from an occurrence after Nov 23, if there is one.",
    });
    expect(google.writes()).toEqual([]);
  });

  test("a new length is refused while an occurrence has a length of its own", async () => {
    // Nov 23 runs to 10:00 on its own; the series' 30 minutes become 45.
    const longer = occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
      end: "2026-11-23T10:00:00-05:00",
      start: "2026-11-23T09:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [longer]);
    expect(
      await refusalOf(
        edit("all", weekly, {
          end: { dateTime: "2026-11-09T09:45:00-05:00", timeZone: zone },
        })
      )
    ).toEqual({
      code: "BAD_REQUEST",
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "resizesChangedOccurrences",
      },
      message:
        "This would also change the length of single occurrences given a length of their own (Nov 23), so it wasn't saved. Save it for this occurrence only, or with This and following from an occurrence after Nov 23, if there is one.",
    });
    expect(google.writes()).toEqual([]);
  });

  test("a new length an occurrence already has saves", async () => {
    // Nov 23 runs to 10:00 on its own; the series' 30 minutes become 60,
    // so Google's new length for it is the one it has.
    const longer = occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
      end: "2026-11-23T10:00:00-05:00",
      start: "2026-11-23T09:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [longer]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", weekly, {
            end: { dateTime: "2026-11-09T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      end: { dateTime: "2026-11-09T10:00:00-05:00" },
    });
  });

  test.each([
    [
      "an UNTIL before it",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261118T045959Z",
      true,
    ],
    [
      "an UNTIL after it",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T045959Z",
      false,
    ],
    ["a COUNT that ends before it", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2", true],
    ["a COUNT that reaches it", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3", false],
  ])(
    "a new end with %s refuses only when it drops Nov 23, renamed on its own",
    async (_case, rule, drops) => {
      const google = fakeGoogle(weekly, [renamed("2026-11-23T09:00:00-05:00")]);
      const save = edit("all", nov16, { recurrence: [rule] });
      if (drops) {
        expect(await refusalOf(save)).toMatchObject({
          data: {
            originalStarts: ["2026-11-23T09:00:00-05:00"],
            reason: "dropsChangedOccurrences",
          },
        });
        expect(google.writes()).toEqual([]);
      } else {
        expect(Exit.isSuccess(await run(save))).toBe(true);
        expect(google.writes()[0]?.body?.recurrence).toEqual([rule]);
      }
    }
  );

  test.each([
    [
      "hourly from 9:00, 11:00 renamed, made to end after two meetings",
      { recurrence: ["RRULE:FREQ=HOURLY"] },
      "2026-11-09T11:00:00-05:00",
      "RRULE:FREQ=HOURLY;COUNT=2",
      true,
    ],
    [
      "hourly from 9:00, 11:00 renamed, made to end after three meetings",
      { recurrence: ["RRULE:FREQ=HOURLY"] },
      "2026-11-09T11:00:00-05:00",
      "RRULE:FREQ=HOURLY;COUNT=3",
      false,
    ],
    [
      "all-day weekly, Nov 30 renamed, made to end after three",
      {
        end: { date: "2026-11-10" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        start: { date: "2026-11-09" },
      },
      "2026-11-30",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
      true,
    ],
    [
      "all-day weekly, Nov 30 renamed, made to end after four",
      {
        end: { date: "2026-11-10" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        start: { date: "2026-11-09" },
      },
      "2026-11-30",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4",
      false,
    ],
  ] as const)(
    "%s refuses only when it drops it",
    async (_case, shape, renamedAt, rule, drops) => {
      const series: Event = {
        ...weekly,
        ...shape,
        recurrence: [...shape.recurrence],
      };
      const own = {
        ...series,
        end: series.end,
        id: `series_${renamedAt.replace(/[-:]/g, "")}`,
        originalStartTime:
          renamedAt.length === 10
            ? { date: renamedAt }
            : { dateTime: renamedAt, timeZone: zone },
        recurrence: undefined,
        recurringEventId: "series",
        start:
          renamedAt.length === 10
            ? { date: renamedAt }
            : { dateTime: renamedAt, timeZone: zone },
        summary: "Planning (renamed)",
      };
      const google = fakeGoogle(series, [own]);
      const save = edit("all", series, { recurrence: [rule] });
      if (drops) {
        expect(await refusalOf(save)).toMatchObject({
          data: { reason: "dropsChangedOccurrences" },
        });
        expect(google.writes()).toEqual([]);
      } else {
        expect(Exit.isSuccess(await run(save))).toBe(true);
      }
    }
  );

  test("a skip added on an occurrence changed on its own is refused", async () => {
    fakeGoogle(weekly, [renamed("2026-11-23T09:00:00-05:00")]);
    expect(
      await refusalOf(
        edit("all", nov16, {
          recurrence: [
            "RRULE:FREQ=WEEKLY;BYDAY=MO",
            "EXDATE;TZID=America/New_York:20261123T090000",
          ],
        })
      )
    ).toMatchObject({ data: { reason: "dropsChangedOccurrences" } });
  });

  test("a new day offers this occurrence, a new repeat with it doesn't", async () => {
    // The series moved from Mondays to Tuesdays, its rule rebuilt for the
    // new day; then every other Tuesday as well.
    const google = fakeGoogle(weekly, [renamed("2026-11-23T09:00:00-05:00")]);
    const toTuesdays = (rule: string) =>
      refusalOf(
        edit("all", weekly, {
          end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
          recurrence: [rule],
          start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
        })
      );
    expect(await toTuesdays("RRULE:FREQ=WEEKLY;BYDAY=TU")).toEqual({
      code: "BAD_REQUEST",
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
      },
      message:
        "This would undo what was changed or deleted on single occurrences (Nov 23), so it wasn't saved. Save it for this occurrence only, or with This and following from an occurrence after Nov 23, if there is one.",
    });
    expect(
      await toTuesdays("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")
    ).toMatchObject({
      data: { seriesOnly: true },
      message:
        "This would undo what was changed or deleted on single occurrences (Nov 23), so it wasn't saved. Save it with This and following from an occurrence after Nov 23, if there is one.",
    });
    expect(google.writes()).toEqual([]);
  });

  test("a new length with a new repeat doesn't offer this occurrence", async () => {
    // Nov 23 runs to 10:00 on its own; the series' 30 minutes become 45,
    // and it meets on Thursdays too (Nov 23 still a meeting).
    const longer = occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
      end: "2026-11-23T10:00:00-05:00",
      start: "2026-11-23T09:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [longer]);
    expect(
      await refusalOf(
        edit("all", weekly, {
          end: { dateTime: "2026-11-09T09:45:00-05:00", timeZone: zone },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
        })
      )
    ).toEqual({
      code: "BAD_REQUEST",
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "resizesChangedOccurrences",
        seriesOnly: true,
      },
      message:
        "This would also change the length of single occurrences given a length of their own (Nov 23), so it wasn't saved. Save it with This and following from an occurrence after Nov 23, if there is one.",
    });
    expect(google.writes()).toEqual([]);
  });

  test("a new length is saved when changed occurrences keep the series' length", async () => {
    // Nov 23 moved to 14:00, still 30 minutes: Google keeps it and gives it
    // the new length, as the user asked for every meeting.
    const google = fakeGoogle(weekly, [
      occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
        end: "2026-11-23T14:30:00-05:00",
        start: "2026-11-23T14:00:00-05:00",
      }),
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", weekly, {
            end: { dateTime: "2026-11-09T09:45:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
    expect(google.writes()[0]?.body).toMatchObject({
      end: { dateTime: "2026-11-09T09:45:00-05:00", timeZone: zone },
    });
  });

  test("a new length set through an occurrence of its own length is saved on it", async () => {
    // Nov 16 runs to 10:00 on its own; from it the user makes the series
    // two hours long. Its length is the one being set.
    const opened = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-16T10:00:00-05:00",
      start: "2026-11-16T09:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [opened]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", opened, {
            end: { dateTime: "2026-11-16T11:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [series, own] = google.writes();
    expect(series?.body).toMatchObject({
      end: { dateTime: "2026-11-09T11:00:00-05:00", timeZone: zone },
    });
    expect(own?.body).toMatchObject({
      end: { dateTime: "2026-11-16T11:00:00-05:00", timeZone: zone },
    });
  });

  test("an exception Google cancelled with its series' fields gone is passed over", async () => {
    // Left by an earlier start move: its own id and start, status cancelled,
    // no originalStartTime or recurringEventId.
    const orphan = {
      end: { dateTime: "2026-11-23T14:30:00-05:00", timeZone: zone },
      id: "series_20261123T140000Z",
      start: { dateTime: "2026-11-23T14:00:00-05:00", timeZone: zone },
      status: "cancelled",
    } as Event;
    const google = fakeGoogle(weekly, [orphan]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", nov16, {
            recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"],
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
    ]);
  });
});

describe("follow-up checks on the start and length rules", () => {
  test("a length-only change in a series with an exclusion rule still saves", async () => {
    // Daily but weekends, Nov 23 renamed (the series' length): its slot
    // isn't moved, so nothing of its own is at stake.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=DAILY", "EXRULE:FREQ=WEEKLY;BYDAY=SA,SU"],
    };
    const google = fakeGoogle(series, [
      {
        ...occurrenceOf(series, "2026-11-23T09:00:00-05:00"),
        summary: "Planning (renamed)",
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", series, {
            end: { dateTime: "2026-11-09T09:45:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    expect(google.writes()).toHaveLength(1);
  });
});

describe("a rule as Google reads it", () => {
  // Google meets a day-or-longer rule once a day, at the start's time, and
  // ignores a list of times there.
  const meets = (rule: string, slot: string) =>
    seriesMeetsAt({
      recurrence: [rule],
      seriesZone: zone,
      slot,
      start: { dateTime: "2026-11-02T09:00:00-05:00" },
    });

  test("a list of times still meets once a day, at the start's time", () => {
    const rule = "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,15";
    expect(meets(rule, "2026-11-16T09:00:00-05:00")).toBe(true);
    expect(meets(rule, "2026-11-16T15:00:00-05:00")).toBe(false);
    expect(meets(rule, "2026-11-17T09:00:00-05:00")).toBe(false);
  });

  test("BYSETPOS picks among days, not a list of times", () => {
    const rule = "RRULE:FREQ=MONTHLY;BYDAY=MO;BYHOUR=9,15;BYSETPOS=1";
    expect(meets(rule, "2026-12-07T09:00:00-05:00")).toBe(true);
    expect(meets(rule, "2026-12-14T09:00:00-05:00")).toBe(false);
  });
});

describe("newRepeat", () => {
  test("the same days listed in another order aren't a new repeat", () => {
    expect(
      newRepeat({
        moved: null,
        own: ["RRULE:FREQ=WEEKLY;BYDAY=WE,MO;COUNT=6"],
        saved: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6"],
      })
    ).toBe(false);
  });

  test("a new day's rule rebuilt for it isn't a new repeat", () => {
    // Monthly on the first Saturday, moved to the second Sunday: the
    // editor rebuilds which day it picks, in any form.
    const own = ["RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1"];
    // Sat Nov 7 to Sun Nov 8.
    const moved = {
      from: Temporal.PlainDate.from("2026-11-07"),
      to: Temporal.PlainDate.from("2026-11-08"),
    };
    for (const rule of [
      "RRULE:FREQ=MONTHLY;BYDAY=2SU",
      "RRULE:FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2",
    ]) {
      expect(newRepeat({ moved, own, saved: [rule] })).toBe(false);
    }
    // Every other month is a new repeat, and so is a new day kept, and two
    // days a month.
    expect(
      newRepeat({
        moved,
        own,
        saved: ["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2SU"],
      })
    ).toBe(true);
    expect(
      newRepeat({ moved: null, own, saved: ["RRULE:FREQ=MONTHLY;BYDAY=2SU"] })
    ).toBe(true);
    expect(
      newRepeat({
        moved,
        own,
        saved: ["RRULE:FREQ=MONTHLY;BYDAY=2SU,4SU"],
      })
    ).toBe(true);
  });

  test("a first meeting moved with days added names no single occurrence", async () => {
    // Nov 23 renamed on its own; the first meeting moves from Mon Nov 9 to
    // Tue Nov 10, and the rule to Tuesdays and Thursdays: only a series
    // takes that, so the words offer This and following alone.
    const google = fakeGoogle(weekly, [
      { ...occurrenceOf(weekly, "2026-11-23T09:00:00-05:00"), summary: "Own" },
    ]);
    expect(
      await refusalOf(
        edit("all", weekly, {
          end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"],
          start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
        })
      )
    ).toMatchObject({
      data: { reason: "dropsChangedOccurrences", seriesOnly: true },
    });
    expect(google.writes()).toEqual([]);
  });

  test("a monthly day rebuilt for a shorter one isn't a new repeat", () => {
    // Monthly on the 31st five times, moved from May 31 to May 30: the
    // editor rebuilds it as the 30th, which meets more often in a year.
    const moved = {
      from: Temporal.PlainDate.from("2026-05-31"),
      to: Temporal.PlainDate.from("2026-05-30"),
    };
    expect(
      newRepeat({
        moved,
        own: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=5"],
        saved: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=30;COUNT=5"],
      })
    ).toBe(false);
  });

  test("a monthly day given a second day is a new repeat, whatever its end", () => {
    // The 9th made the 9th and 10th, three times either way.
    const moved = {
      from: Temporal.PlainDate.from("2026-11-09"),
      to: Temporal.PlainDate.from("2026-11-10"),
    };
    expect(
      newRepeat({
        moved,
        own: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=9;COUNT=3"],
        saved: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=9,10;COUNT=3"],
      })
    ).toBe(true);
  });

  test("a weekly rule moved to a new day keeps its other days", () => {
    // Mon Nov 9 moved to Tue Nov 10.
    const moved = {
      from: Temporal.PlainDate.from("2026-11-09"),
      to: Temporal.PlainDate.from("2026-11-10"),
    };
    const saving = (own: string, saved: string) =>
      newRepeat({ moved, own: [own], saved: [saved] });
    expect(
      saving("RRULE:FREQ=WEEKLY;BYDAY=MO", "RRULE:FREQ=WEEKLY;BYDAY=TU")
    ).toBe(false);
    expect(
      saving("RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "RRULE:FREQ=WEEKLY;BYDAY=WE,TU")
    ).toBe(false);
    // A day added, or another changed, is a new repeat.
    expect(
      saving("RRULE:FREQ=WEEKLY;BYDAY=MO", "RRULE:FREQ=WEEKLY;BYDAY=TU,TH")
    ).toBe(true);
    expect(
      saving("RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "RRULE:FREQ=WEEKLY;BYDAY=TU,TH")
    ).toBe(true);
  });
});

describe("an Entire series save that changes only the end", () => {
  const at = (dateTime: string) => ({ dateTime, timeZone: zone });

  test("through an occurrence moved on its own, keeps the series' start", async () => {
    // Nov 16 was moved to 11:00 on its own; its end goes to 11:45.
    const moved = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-16T11:30:00-05:00",
      start: "2026-11-16T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved]);
    expect(
      Exit.isSuccess(
        await run(edit("all", moved, { end: at("2026-11-16T11:45:00-05:00") }))
      )
    ).toBe(true);
    const [series, opened] = google.writes();
    expect(series?.body).toMatchObject({
      end: at("2026-11-09T09:45:00-05:00"),
      start: { dateTime: "2026-11-09T09:00:00-05:00" },
    });
    // Nov 16 keeps its own move, with the new length.
    expect(opened?.body).toMatchObject({
      end: { dateTime: "2026-11-16T11:45:00-05:00" },
      start: { dateTime: "2026-11-16T11:00:00-05:00" },
    });
  });

  test("in a series that meets several times a day, saves the new length", async () => {
    // A rule at 9:00 and one at 15:00; Dec 2's 15:00 now ends at 15:45.
    const twice: Event = {
      ...weekly,
      end: at("2026-12-01T09:30:00-05:00"),
      recurrence: [
        "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=3",
        "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=3",
      ],
      start: at("2026-12-01T09:00:00-05:00"),
    };
    const google = fakeGoogle(twice);
    expect(
      Exit.isSuccess(
        await run(
          edit("all", occurrenceOf(twice, "2026-12-02T15:00:00-05:00"), {
            end: at("2026-12-02T15:45:00-05:00"),
          })
        )
      )
    ).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      end: at("2026-12-01T09:45:00-05:00"),
      recurrence: twice.recurrence,
      start: at("2026-12-01T09:00:00-05:00"),
    });
  });
});

describe("seriesMeetsAt", () => {
  test("a rule meets at the first of an hour a clock change repeats", () => {
    // Daily at 1:30 New York: on Nov 1 clocks go back at 2:00, so 1:30
    // comes twice. The rule meets at the first (5:30 UTC) only.
    const meetsAt = (slot: string) =>
      seriesMeetsAt({
        recurrence: ["RRULE:FREQ=DAILY"],
        seriesZone: zone,
        slot,
        start: { dateTime: "2026-10-25T01:30:00-04:00" },
      });
    expect(meetsAt("2026-11-01T01:30:00-04:00")).toBe(true);
    expect(meetsAt("2026-11-01T01:30:00-05:00")).toBe(false);
  });
});
