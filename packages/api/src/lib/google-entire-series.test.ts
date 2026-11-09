import { describe, expect, test } from "bun:test";
import { isRuleDay } from "@kompose/google-cal/rule-days";
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

  test("a first meeting moved under a rule that can't be read keeps the series' date", async () => {
    // A day-of-year rule isn't read here, so whether it meets Jan 2 can't
    // be told: the series keeps Jan 1, as main did.
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
    ).toMatchObject({ data: { reason: "dropsChangedOccurrences" } });
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
        "This would undo changes made to single occurrences (Nov 23), so it wasn't saved. Save it for this occurrence only, or with This and following from an occurrence after Nov 23.",
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
        "This would also change the length of single occurrences given a length of their own (Nov 23), so it wasn't saved. Save it for this occurrence only, or with This and following from an occurrence after Nov 23.",
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
        "This would undo changes made to single occurrences (Nov 23), so it wasn't saved. Save it for this occurrence only, or with This and following from an occurrence after Nov 23.",
    });
    expect(
      await toTuesdays("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU")
    ).toMatchObject({
      data: { seriesOnly: true },
      message:
        "This would undo changes made to single occurrences (Nov 23), so it wasn't saved. Save it with This and following from an occurrence after Nov 23.",
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
        "This would also change the length of single occurrences given a length of their own (Nov 23), so it wasn't saved. Save it with This and following from an occurrence after Nov 23.",
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

describe("newRepeat", () => {
  test("a new day's rule rebuilt for it isn't a new repeat", () => {
    // Monthly on the first Saturday, moved to the second Sunday: the
    // editor rebuilds which day it picks, in any form.
    const own = ["RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1"];
    for (const rule of [
      "RRULE:FREQ=MONTHLY;BYDAY=2SU",
      "RRULE:FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2",
    ]) {
      expect(newRepeat({ dayMoved: true, own, saved: [rule] })).toBe(false);
    }
    // Every other month is a new repeat, and so is a new day kept.
    expect(
      newRepeat({
        dayMoved: true,
        own,
        saved: ["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2SU"],
      })
    ).toBe(true);
    expect(
      newRepeat({
        dayMoved: false,
        own,
        saved: ["RRULE:FREQ=MONTHLY;BYDAY=2SU"],
      })
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
