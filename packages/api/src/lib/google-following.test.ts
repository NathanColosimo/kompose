/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  splitAddedDays,
  truncateRecurrenceForFollowing,
} from "@kompose/google-cal/recurrence-utils";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import { Exit } from "effect";
import {
  BASE32HEX_ID,
  edit,
  failure,
  fakeGoogle,
  nov16,
  occurrenceOf,
  type Request,
  refusalOf,
  run,
  service,
  weekly,
  zone,
} from "./google-test-fixtures";

// This and following: a new series created first, occurrences carried
// onto it, the old series cut, and a failed split rolled back.

describe("This and following", () => {
  test("creates the new series, then ends the old one the second before", async () => {
    const google = fakeGoogle(weekly);
    // Written without an offset, in its zone.
    const exit = await run(
      edit("following", nov16, {
        end: { dateTime: "2026-11-23T09:30:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        start: { dateTime: "2026-11-23T09:00:00", timeZone: zone },
        summary: "Planning (new room)",
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.method).toBe("POST");
    expect(created?.body).toMatchObject({
      end: { dateTime: "2026-11-23T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-23T09:00:00-05:00", timeZone: zone },
      summary: "Planning (new room)",
    });
    // Its own id (Google's base32hex), never the old series' iCalUID.
    expect(String(created?.body?.id)).toMatch(BASE32HEX_ID);
    expect(created?.body).not.toHaveProperty("iCalUID");
    expect(cut?.method).toBe("PUT");
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(cut?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T135959Z",
    ]);
    expect(cut?.body?.summary).toBe("Planning");
    expect(google.writes()).toHaveLength(2);
  });

  test("a start written in another zone, without an offset, keeps its moment", async () => {
    // 09:00 Tokyo on Nov 23 is 19:00 New York on Nov 22 (the series' zone).
    const google = fakeGoogle(weekly);
    const exit = await run(
      edit("following", nov16, {
        end: { dateTime: "2026-11-23T09:30:00", timeZone: "Asia/Tokyo" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"],
        start: { dateTime: "2026-11-23T09:00:00", timeZone: "Asia/Tokyo" },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[0]?.body).toMatchObject({
      end: { dateTime: "2026-11-22T19:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-22T19:00:00-05:00", timeZone: zone },
    });
  });

  test("carries a later moved occurrence into the new series", async () => {
    // Nov 30 was moved to 12:00 and renamed on its own; the series from
    // Nov 16 moves to 15:00. Nov 30 keeps its 12:00 and its title, now
    // on the new series' Nov 30 (its 15:00 slot there).
    const moved = {
      ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00", {
        end: "2026-11-30T12:30:00-05:00",
        start: "2026-11-30T12:00:00-05:00",
      }),
      summary: "Planning (long)",
    };
    const google = fakeGoogle(weekly, [moved]);
    const exit = await run(
      edit("following", nov16, {
        end: { dateTime: "2026-11-16T15:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-16T15:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [created, carried, cut] = google.writes();
    const newId = String(created?.body?.id);
    const lookup = google.requests.find((request) =>
      request.url.pathname.endsWith(`/events/${newId}/instances`)
    );
    expect(lookup?.url.searchParams.get("originalStart")).toBe(
      "2026-11-30T15:00:00-05:00"
    );
    expect(carried?.method).toBe("PUT");
    expect(carried?.url.pathname).toEndWith(
      `/events/${newId}_20261130T200000Z`
    );
    expect(carried?.body).toMatchObject({
      end: { dateTime: "2026-11-30T12:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-30T12:00:00-05:00", timeZone: zone },
      summary: "Planning (long)",
    });
    // The old series is cut only once the new one holds it.
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(google.writes()).toHaveLength(3);
  });

  test("refuses, before writing, when a moved occurrence has no place in the new series", async () => {
    // Nov 23 was moved on its own; from Nov 16 the series becomes every
    // other week, so it has no Nov 23 to keep it on.
    const moved = occurrenceOf(weekly, "2026-11-23T09:00:00-05:00", {
      end: "2026-11-23T11:30:00-05:00",
      start: "2026-11-23T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved]);
    expect(
      await refusalOf(
        edit("following", nov16, {
          recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"],
        })
      )
    ).toEqual({
      code: "BAD_REQUEST",
      data: {
        originalStarts: ["2026-11-23T09:00:00-05:00"],
        reason: "dropsChangedOccurrences",
        seriesOnly: true,
      },
      // One occurrence can't take a new repeat.
      message:
        "This would undo changes made to single occurrences (Nov 23), so it wasn't saved. Save it with This and following from an occurrence after Nov 23.",
    });
    expect(google.writes()).toEqual([]);
  });

  test("from a moved occurrence, applies only what the user changed", async () => {
    // Nov 16 was moved to Tue Nov 17 11:00 and renamed on its own. Opened
    // there, the user only adds Thursdays: the series keeps its Monday
    // 9:00 and title from Nov 16, and Nov 16 keeps its own move and name.
    const opened = {
      ...occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
        end: "2026-11-17T11:30:00-05:00",
        start: "2026-11-17T11:00:00-05:00",
      }),
      summary: "Planning (moved)",
    };
    const google = fakeGoogle(weekly, [opened]);
    const exit = await run(
      edit("following", opened, {
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body).toMatchObject({
      end: { dateTime: "2026-11-16T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"],
      start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
      summary: "Planning",
    });
    expect(carried?.body).toMatchObject({
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
      summary: "Planning (moved)",
    });
  });

  test("from the first occurrence, edits the series itself", async () => {
    const first = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00");
    const google = fakeGoogle(weekly);
    const exit = await run(
      edit("following", first, {
        end: { dateTime: "2026-11-10T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
        start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const writes = google.writes();
    expect(writes.map((write) => write.method)).toEqual(["PUT"]);
    expect(writes[0]?.url.pathname).toEndWith("/events/series");
    expect(writes[0]?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
      start: { dateTime: "2026-11-10T09:00:00-05:00", timeZone: zone },
    });
  });
});

describe("a split that fails part way leaves the old series whole", () => {
  const rename = () => edit("following", nov16, { summary: "Planning (new)" });
  const isCut = (request: Request) =>
    request.method === "PUT" && request.url.pathname.endsWith("/events/series");
  const readsSeries = (request: Request) =>
    request.method === "GET" && request.url.pathname.endsWith("/events/series");

  test("deletes the new series when it can't be created", async () => {
    const google = fakeGoogle(weekly, [], (request) =>
      request.method === "POST" ? failure(400) : undefined
    );
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    const [created, deleted] = google.writes();
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "DELETE",
    ]);
    expect(deleted?.url.pathname).toEndWith(`/events/${created?.body?.id}`);
  });

  test("deletes the new series when a moved occurrence can't be carried", async () => {
    const moved = occurrenceOf(weekly, "2026-11-30T09:00:00-05:00", {
      end: "2026-11-30T12:30:00-05:00",
      start: "2026-11-30T12:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [moved], (request) =>
      request.method === "PUT" && !isCut(request) ? failure(400) : undefined
    );
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
      "DELETE",
    ]);
  });

  test("deletes the new series when the cut fails and the old one reads whole", async () => {
    const google = fakeGoogle(weekly, [], (request) =>
      isCut(request) ? failure(400) : undefined
    );
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
      "DELETE",
    ]);
  });

  test("keeps the split when the cut's answer failed but it went through", async () => {
    let master = weekly;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        master = {
          ...weekly,
          recurrence: request.body?.recurrence as string[],
        };
        return failure(400);
      }
      return readsSeries(request) ? master : undefined;
    });
    expect(Exit.isSuccess(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
    ]);
  });

  test("leaves both series when the cut fails and the old one can't be read", async () => {
    // Showing a meeting twice beats losing one.
    let reads = 0;
    const google = fakeGoogle(weekly, [], (request) => {
      if (isCut(request)) {
        return failure(400);
      }
      if (readsSeries(request)) {
        reads += 1;
        return reads > 1 ? failure(404) : weekly;
      }
    });
    expect(Exit.isFailure(await run(rename()))).toBe(true);
    expect(google.writes().map((write) => write.method)).toEqual([
      "POST",
      "PUT",
    ]);
  });

  test("a move to another calendar deletes its new series on failure too", async () => {
    const google = fakeGoogle(weekly, [nov16], (request) =>
      request.method === "POST" ? failure(403) : undefined
    );
    expect(
      Exit.isFailure(
        await run(service().moveEvent("primary", nov16.id, "work", "following"))
      )
    ).toBe(true);
    const [created, deleted] = google.writes();
    expect(created?.url.pathname).toContain("/calendars/work/");
    expect(created?.body).toMatchObject({
      start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
    });
    expect(deleted?.method).toBe("DELETE");
    expect(deleted?.url.pathname).toContain("/calendars/work/");
  });
});

describe("a move to another calendar from an occurrence", () => {
  test("offers no single occurrence when it's refused", async () => {
    // A rule by days of the year (Mondays Nov 9 to Dec 7) isn't read, so
    // a renamed Nov 30 can't be told to have a place in the moved series.
    // One occurrence can't move to another calendar on its own.
    const series: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=YEARLY;BYYEARDAY=313,320,327,334,341"],
    };
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    const google = fakeGoogle(series, [
      opened,
      { ...occurrenceOf(series, "2026-11-30T09:00:00-05:00"), summary: "Mine" },
    ]);
    expect(
      await refusalOf(
        service().moveEvent("primary", opened.id, "work", "following")
      )
    ).toMatchObject({
      data: { reason: "dropsChangedOccurrences", seriesOnly: true },
      message:
        "This would undo changes made to single occurrences (Nov 30), so it wasn't saved. Save it with This and following from an occurrence after Nov 30.",
    });
    expect(google.writes()).toEqual([]);
  });
});

describe("what Google keeps as an occurrence's own", () => {
  test("a deleted occurrence Google lists with only its ids is still read", async () => {
    const google = fakeGoogle(weekly, [
      {
        id: "series_20261130T140000Z",
        originalStartTime: {
          dateTime: "2026-11-30T09:00:00-05:00",
          timeZone: zone,
        },
        recurringEventId: "series",
        status: "cancelled",
      } as Event,
    ]);
    expect(
      Exit.isSuccess(
        await run(edit("following", nov16, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    // Skipped at the series' own time (Google takes it in UTC).
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE:20261130T140000Z",
    ]);
  });

  test("a carried occurrence keeps its own meeting link", async () => {
    const meet = {
      conferenceId: "abc-defg-hij",
      conferenceSolution: { key: { type: "hangoutsMeet" } },
    };
    const google = fakeGoogle(weekly, [
      {
        ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
        conferenceData: meet,
      },
    ]);
    expect(
      Exit.isSuccess(
        await run(edit("following", nov16, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    const [, carried] = google.writes();
    expect(carried?.body?.conferenceData).toEqual(meet);
    expect(carried?.url.searchParams.get("conferenceDataVersion")).toBe("1");
    // It keeps its place in the new series.
    expect(carried?.body?.recurringEventId).toBe(google.writes()[0]?.body?.id);
  });

  test("an original start written without an offset is read in its zone", async () => {
    const opened = {
      ...nov16,
      originalStartTime: { dateTime: "2026-11-16T09:00:00", timeZone: zone },
    };
    const google = fakeGoogle(weekly, [opened]);
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.body?.start).toEqual({
      dateTime: "2026-11-16T09:00:00-05:00",
      timeZone: zone,
    });
    expect(cut?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T135959Z",
    ]);
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

  test("This and following: the new series is the series', the moved one stays moved", async () => {
    const google = fakeGoogle(weekly, [moved]);
    expect(
      Exit.isSuccess(
        await run(save("following", moved, { location: "Room 2" }))
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body).toMatchObject({
      location: "Room 2",
      start: { dateTime: "2026-11-16T09:00:00-05:00", timeZone: zone },
      summary: "Planning",
    });
    expect(created?.body).not.toHaveProperty("description");
    expect(carried?.body).toMatchObject({
      description: "Bring the draft",
      location: "Room 2",
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
      summary: "Planning (moved)",
    });
  });
});

describe("This and following keeps what a later occurrence has", () => {
  test("an empty field the form sends doesn't clear a later occurrence's own", async () => {
    // A form writes an empty description as "". Nov 30 has notes of its
    // own; renaming from Nov 16 keeps them there.
    const own = {
      ...occurrenceOf(weekly, "2026-11-30T09:00:00-05:00"),
      description: "Bring the draft",
    };
    const google = fakeGoogle(weekly, [own]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            description: "",
            location: "",
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body?.summary).toBe("Planning (new)");
    expect(carried?.body).toMatchObject({ description: "Bring the draft" });
    expect(google.writes()).toHaveLength(3);
  });

  test("a moved added meeting stays on its own slot, not the rule's", async () => {
    // Mondays 9:00 plus an added Nov 30 15:00, moved to 16:00 on its own.
    // Renamed from Nov 16, the move stays on the 15:00 meeting; Nov 30's
    // 9:00 meeting is left alone.
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261130T150000",
      ],
    };
    const moved = occurrenceOf(series, "2026-11-30T15:00:00-05:00", {
      end: "2026-11-30T16:30:00-05:00",
      start: "2026-11-30T16:00:00-05:00",
    });
    const google = fakeGoogle(series, [moved]);
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    const [created, carried] = google.writes();
    expect(created?.body?.recurrence).toEqual(series.recurrence);
    const lookup = google.requests.find((request) =>
      request.url.pathname.endsWith(`/events/${created?.body?.id}/instances`)
    );
    expect(lookup?.url.searchParams.get("originalStart")).toBe(
      "2026-11-30T15:00:00-05:00"
    );
    expect(carried?.body).toMatchObject({
      start: { dateTime: "2026-11-30T16:00:00-05:00", timeZone: zone },
    });
  });
});

describe("edges a series write has to tell apart", () => {
  test("an added meeting before the series' start isn't its first meeting", async () => {
    // Mondays from Nov 9, plus added Nov 1 and Nov 5: This and following
    // from Nov 5 can't start a series there (and mustn't change Nov 1).
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(series, "2026-11-05T09:00:00-05:00"), {
          summary: "Planning (new)",
        })
      )
    ).toMatchObject({ data: { reason: "addedOccurrence" } });
    expect(google.writes()).toEqual([]);
  });

  test("deleting from an added meeting before the series' start also skips that start", async () => {
    // Mondays from Nov 9, plus added Nov 1 and Nov 5: deleting from Nov 5
    // on leaves only Nov 1. The cut alone would leave Nov 9, which Google
    // keeps as the series' start whatever its rule says.
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
      ],
    };
    const opened = occurrenceOf(series, "2026-11-05T09:00:00-05:00");
    const google = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(google.writes().map((write) => write.body?.recurrence)).toEqual([
      [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261105T135959Z",
        "RDATE;TZID=America/New_York:20261101T090000",
        "EXDATE:20261109T140000Z",
      ],
    ]);
  });

  test("a field cleared for the following meetings clears a later one's own too", async () => {
    // Nov 30 had its own notes; the user clears the notes from Nov 16 on.
    const noted = { ...weekly, description: "Agenda in the doc" };
    const own = {
      ...occurrenceOf(noted, "2026-11-30T09:00:00-05:00"),
      description: "Bring the draft",
    };
    const google = fakeGoogle(noted, [own]);
    const opened = occurrenceOf(noted, "2026-11-16T09:00:00-05:00");
    expect(
      Exit.isSuccess(await run(edit("following", opened, { description: "" })))
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.body?.description).toBe("");
    // Nothing of Nov 30's own is left to carry.
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(google.writes()).toHaveLength(2);
  });
});

describe("series shapes a write has to keep as they are", () => {
  test("This and following from the first meeting splits there with meetings added before it", async () => {
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", occurrenceOf(series, "2026-11-09T09:00:00-05:00"), {
            summary: "Planning (new)",
          })
        )
      )
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.method).toBe("POST");
    expect(created?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
      summary: "Planning (new)",
    });
    // The old series keeps only the meetings added before Nov 9: its rule
    // ends before then, and Nov 9, its start, is skipped.
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(cut?.body).toMatchObject({
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261109T135959Z",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
        "EXDATE:20261109T140000Z",
      ],
      summary: "Planning",
    });
    expect(google.writes()).toHaveLength(2);
  });

  test("Repeat: None from a moved occurrence keeps it as one event, as it was", async () => {
    // Nov 16 was moved to Tue Nov 17 11:00; from it, the repeat is ended.
    const opened = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00", {
      end: "2026-11-17T11:30:00-05:00",
      start: "2026-11-17T11:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [opened]);
    expect(
      Exit.isSuccess(await run(edit("following", opened, { recurrence: [] })))
    ).toBe(true);
    const [created, cut] = google.writes();
    expect(created?.body).toMatchObject({
      recurrence: [],
      start: { dateTime: "2026-11-17T11:00:00-05:00", timeZone: zone },
    });
    // One event: no occurrences to look up or write.
    expect(
      google.requests.some((request) =>
        request.url.pathname.endsWith("/instances")
      )
    ).toBe(false);
    expect(cut?.url.pathname).toEndWith("/events/series");
    expect(google.writes()).toHaveLength(2);
  });

  test("a carried occurrence that dropped the series' meeting link keeps it dropped", async () => {
    const meet = {
      conferenceId: "abc-defg-hij",
      conferenceSolution: { key: { type: "hangoutsMeet" } },
    };
    const series = { ...weekly, conferenceData: meet };
    const { conferenceData: _meet, ...withoutLink } = occurrenceOf(
      series,
      "2026-11-30T09:00:00-05:00"
    );
    const google = fakeGoogle(series, [withoutLink]);
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    // Only Nov 30 is carried: the opened Nov 16 has the series' link,
    // whatever order its fields come in.
    const [, carried] = google.writes();
    expect(google.writes()).toHaveLength(3);
    expect(carried?.url.pathname).toEndWith("_20261130T140000Z");
    expect(carried?.url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(carried?.body).not.toHaveProperty("conferenceData");
  });
});

describe("This and following, where the new series sits", () => {
  test("refuses two moved occurrences that would land on one meeting", async () => {
    // Mondays plus an added Tue Dec 1, both Nov 30 and Dec 1 moved on
    // their own. From Nov 16 the series moves to Tuesdays: Nov 30 would
    // land on Dec 1, which the added meeting holds.
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261201T090000",
      ],
    };
    const movedTo = (original: string, start: string, end: string) =>
      occurrenceOf(series, original, { end, start });
    const google = fakeGoogle(series, [
      movedTo(
        "2026-11-30T09:00:00-05:00",
        "2026-11-30T13:00:00-05:00",
        "2026-11-30T13:30:00-05:00"
      ),
      movedTo(
        "2026-12-01T09:00:00-05:00",
        "2026-12-01T15:00:00-05:00",
        "2026-12-01T15:30:00-05:00"
      ),
    ]);
    const opened = occurrenceOf(series, "2026-11-16T09:00:00-05:00");
    const refusal = await refusalOf(
      edit("following", opened, {
        end: { dateTime: "2026-11-17T09:30:00-05:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"],
        start: { dateTime: "2026-11-17T09:00:00-05:00", timeZone: zone },
      })
    );
    expect(refusal).toMatchObject({
      data: { reason: "dropsChangedOccurrences" },
    });
    // Its rule follows the new day: one occurrence can take that.
    expect(refusal).not.toHaveProperty("data.seriesOnly");
    expect(
      [
        ...(refusal as { data: { originalStarts: string[] } }).data
          .originalStarts,
      ].sort()
    ).toEqual(["2026-11-30T09:00:00-05:00", "2026-12-01T09:00:00-05:00"]);
    expect(google.writes()).toEqual([]);
  });
});

describe("the opened occurrence takes the user's change", () => {
  test("from a moved and renamed first meeting, a new title reaches it too", async () => {
    // Google keeps an occurrence's own title when its series is renamed,
    // so the first meeting (moved to Tue Nov 10 11:00, titled "Special")
    // is renamed itself; its move stays.
    const first = {
      ...occurrenceOf(weekly, "2026-11-09T09:00:00-05:00", {
        end: "2026-11-10T11:30:00-05:00",
        start: "2026-11-10T11:00:00-05:00",
      }),
      summary: "Special",
    };
    const google = fakeGoogle(weekly, [first]);
    expect(
      Exit.isSuccess(
        await run(edit("following", first, { summary: "New series" }))
      )
    ).toBe(true);
    const [series, opened] = google.writes();
    expect(series?.url.pathname).toEndWith("/events/series");
    expect(series?.body).toMatchObject({
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
      summary: "New series",
    });
    expect(opened?.url.pathname).toEndWith(`/events/${first.id}`);
    expect(opened?.body).toMatchObject({
      start: { dateTime: "2026-11-10T11:00:00-05:00", timeZone: zone },
      summary: "New series",
    });
    expect(google.writes()).toHaveLength(2);
  });
});

describe("an occurrence with only its end changed", () => {
  test("keeps its own start and end through This and following", async () => {
    // Nov 30 runs on to 10:30 (its start left at 9:00); the series moves to
    // 10:00 from Nov 16. Its times are kept as a pair, as for any moved
    // occurrence: 9:00 to 10:30.
    const longer = occurrenceOf(weekly, "2026-11-30T09:00:00-05:00", {
      end: "2026-11-30T10:30:00-05:00",
      start: "2026-11-30T09:00:00-05:00",
    });
    const google = fakeGoogle(weekly, [longer]);
    expect(
      Exit.isSuccess(
        await run(
          edit("following", nov16, {
            end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
            start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
          })
        )
      )
    ).toBe(true);
    const [, carried] = google.writes();
    expect(carried?.url.pathname).toEndWith("_20261130T150000Z");
    expect(carried?.body).toMatchObject({
      end: { dateTime: "2026-11-30T10:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-30T09:00:00-05:00", timeZone: zone },
    });
  });
});

describe("This and following from the first meeting is the whole series", () => {
  const first = occurrenceOf(weekly, "2026-11-09T09:00:00-05:00");

  test("deleting it deletes the series", async () => {
    const google = fakeGoogle(weekly, [first]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", first.id, "following"))
      )
    ).toBe(true);
    const writes = google.writes();
    expect(writes.map((write) => write.method)).toEqual(["DELETE"]);
    expect(writes[0]?.url.pathname).toEndWith("/events/series");
  });

  test("moving it moves the series", async () => {
    const google = fakeGoogle(weekly, [first]);
    expect(
      Exit.isSuccess(
        await run(service().moveEvent("primary", first.id, "work", "following"))
      )
    ).toBe(true);
    const writes = google.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.url.pathname).toEndWith("/events/series/move");
    expect(writes[0]?.url.searchParams.get("destination")).toBe("work");
  });

  test("from an added meeting before the start, with nothing earlier, it's the whole series", async () => {
    // Nov 9 plus an added Nov 2, no rule: from Nov 2 on is all of it.
    const series = {
      ...weekly,
      recurrence: ["RDATE;TZID=America/New_York:20261102T090000"],
    };
    const opened = occurrenceOf(series, "2026-11-02T09:00:00-05:00");
    const deleted = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(
      deleted.writes().map((write) => [write.method, write.url.pathname])
    ).toEqual([["DELETE", "/calendar/v3/calendars/primary/events/series"]]);
    // Mondays from Nov 9 with added Nov 1 and Nov 5: from Nov 1 on is all.
    const earliest = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261101T090000,20261105T090000",
      ],
    };
    const nov1 = occurrenceOf(earliest, "2026-11-01T09:00:00-05:00");
    const all = fakeGoogle(earliest, [nov1]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", nov1.id, "following"))
      )
    ).toBe(true);
    expect(all.writes().map((write) => write.method)).toEqual(["DELETE"]);
    const renamed = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { summary: "Planning (new)" }))
      )
    ).toBe(true);
    expect(
      renamed.writes().map((write) => [write.method, write.body?.summary])
    ).toEqual([["PUT", "Planning (new)"]]);
  });

  test.each([
    ["a new time", "2026-11-02T10:00:00-05:00", undefined],
    ["a new day", "2026-11-03T09:00:00-05:00", undefined],
    ["Repeat: None", "2026-11-02T09:00:00-05:00", []],
  ])(
    "from that added meeting, %s is still refused",
    async (_change, start, recurrence) => {
      // That meeting's own new slot or repeat, which no write of the series
      // gives it: Mondays from Nov 9 plus an added Nov 2, opened at Nov 2.
      const series = {
        ...weekly,
        recurrence: [
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "RDATE;TZID=America/New_York:20261102T090000",
        ],
      };
      const opened = occurrenceOf(series, "2026-11-02T09:00:00-05:00");
      const google = fakeGoogle(series, [opened]);
      expect(
        await refusalOf(
          edit("following", opened, {
            end: {
              dateTime: start.replace(":00:00-", ":30:00-"),
              timeZone: zone,
            },
            start: { dateTime: start, timeZone: zone },
            ...(recurrence ? { recurrence } : {}),
          })
        )
      ).toMatchObject({ data: { reason: "addedOccurrence" } });
      expect(google.writes()).toEqual([]);
    }
  );

  test("from the added meeting of a series of added days only, Repeat: None is still refused", async () => {
    const series = {
      ...weekly,
      recurrence: ["RDATE;TZID=America/New_York:20261102T090000"],
    };
    const opened = occurrenceOf(series, "2026-11-02T09:00:00-05:00");
    const google = fakeGoogle(series, [opened]);
    expect(
      await refusalOf(edit("following", opened, { recurrence: [] }))
    ).toMatchObject({ data: { reason: "addedOccurrence" } });
    expect(google.writes()).toEqual([]);
  });

  test("with meetings added before it, either splits there", async () => {
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261105T090000",
      ],
    };
    const opened = occurrenceOf(series, "2026-11-09T09:00:00-05:00");
    // What's left of the series: Nov 5, added before its start.
    const cutRule = [
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261109T135959Z",
      "RDATE;TZID=America/New_York:20261105T090000",
      "EXDATE:20261109T140000Z",
    ];
    const deleted = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(service().deleteEvent("primary", opened.id, "following"))
      )
    ).toBe(true);
    expect(
      deleted.writes().map((write) => [write.method, write.body?.recurrence])
    ).toEqual([["PUT", cutRule]]);
    const moved = fakeGoogle(series, [opened]);
    expect(
      Exit.isSuccess(
        await run(
          service().moveEvent("primary", opened.id, "work", "following")
        )
      )
    ).toBe(true);
    const [created, cut] = moved.writes();
    expect(created?.url.pathname).toEndWith("/calendars/work/events");
    expect(created?.body).toMatchObject({
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
    });
    expect(cut?.body?.recurrence).toEqual(cutRule);
    expect(moved.writes()).toHaveLength(2);
  });
});

describe("a series This and following can't keep", () => {
  test("one with an exclusion rule is refused before writing", async () => {
    // Daily, skipping every other Sunday from Nov 9: a new series from
    // Nov 16 would skip other Sundays.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=DAILY",
        "EXRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(series, "2026-11-16T09:00:00-05:00"), {
          summary: "Planning (new)",
        })
      )
    ).toMatchObject({ data: { reason: "severalRules" } });
    expect(google.writes()).toEqual([]);
  });

  test("one with two counted rules is refused before anything else is read", async () => {
    // 9:00 and 15:00 daily, five each: one new series can't carry both.
    const series: Event = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=DAILY;BYHOUR=9;COUNT=5",
        "RRULE:FREQ=DAILY;BYHOUR=15;COUNT=5",
      ],
    };
    const google = fakeGoogle(series);
    expect(
      await refusalOf(
        edit("following", occurrenceOf(series, "2026-11-11T15:00:00-05:00"), {
          summary: "Planning (new)",
        })
      )
    ).toMatchObject({ data: { reason: "severalRules" } });
    expect(google.requests.map((request) => request.method)).toEqual(["GET"]);
  });
});

describe("cutting the old series", () => {
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

  test("splits added days written as Google date-times", () => {
    const rule = [
      "RRULE:FREQ=WEEKLY",
      "RDATE:2026-11-16T14:00:00Z,2026-11-23T14:00:00Z",
    ];
    expect(
      splitAddedDays(
        rule,
        "2026-11-20T09:00:00-05:00",
        "America/New_York",
        "from"
      )
    ).toEqual(["RRULE:FREQ=WEEKLY", "RDATE:2026-11-23T14:00:00Z"]);
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
});

describe("This and following in a series that meets within the day", () => {
  test("puts a later occurrence back at its own hour", async () => {
    // Hourly from 9:00; 11:00 was renamed on its own. A location-only
    // save from 10:00 carries it to the new series' 11:00.
    const hourly: Event = {
      ...weekly,
      recurrence: ["RRULE:FREQ=HOURLY"],
    };
    const opened = occurrenceOf(hourly, "2026-11-09T10:00:00-05:00");
    const renamed = {
      ...occurrenceOf(hourly, "2026-11-09T11:00:00-05:00"),
      summary: "Planning (11:00)",
    };
    const google = fakeGoogle(hourly, [opened, renamed]);
    expect(
      Exit.isSuccess(
        await run(edit("following", opened, { location: "Room 1" }))
      )
    ).toBe(true);
    const carried = google
      .writes()
      .find((write) => write.body?.summary === "Planning (11:00)");
    expect(carried?.url.pathname).toEndWith("_20261109T160000Z");
    expect(carried?.body).toMatchObject({
      start: { dateTime: "2026-11-09T11:00:00-05:00" },
    });
  });
});
