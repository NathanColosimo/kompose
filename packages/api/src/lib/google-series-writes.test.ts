/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import { Effect, Exit } from "effect";
import { Temporal } from "temporal-polyfill";

const zone = "America/New_York";
/** An event id Google takes: base32hex (0-9, a-v). */
const BASE32HEX_ID = /^[0-9a-v]{32}$/;

interface Request {
  body: Record<string, unknown> | null;
  method: string;
  url: URL;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Google failing a request with `status`. */
const failure = (status: number) =>
  new Response(JSON.stringify({ error: { code: status } }), { status });

/**
 * Google answers each request with `answer(request)` (a body, or a
 * Response), and every request is recorded. The client takes fetch when
 * it's made, so this runs first.
 */
const stubGoogle = (answer: (request: Request) => unknown) => {
  const requests: Request[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request: Request = {
      body: init?.body ? JSON.parse(String(init.body)) : null,
      method: init?.method ?? "GET",
      url: new URL(String(input)),
    };
    requests.push(request);
    const answered = answer(request);
    return Promise.resolve(
      answered instanceof Response
        ? answered
        : new Response(JSON.stringify(answered), {
            headers: { "content-type": "application/json" },
            status: 200,
          })
    );
  }) as typeof fetch;
  return {
    requests,
    writes: () => requests.filter((request) => request.method !== "GET"),
  };
};

/** "20261116T140000Z": an instance id's suffix, as Google writes it. */
const compact = (dateTime: string) =>
  Temporal.Instant.from(dateTime).toString().replace(/[-:]/g, "");

/** A weekly Monday 9:00 New York series from Nov 9, 2026. */
const weekly: Event = {
  end: { dateTime: "2026-11-09T09:30:00-05:00", timeZone: zone },
  iCalUID: "series@google.com",
  id: "series",
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
  start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
  summary: "Planning",
};

/**
 * `master`'s occurrence originally at `original` (an ISO date-time), as
 * Google lists it, moved to `moved` when given.
 */
const occurrenceOf = (
  master: Event,
  original: string,
  moved?: { end: string; start: string }
): Event => {
  const length = Temporal.Instant.from(master.start.dateTime ?? "").until(
    Temporal.Instant.from(master.end.dateTime ?? "")
  );
  const end =
    moved?.end ??
    Temporal.Instant.from(original)
      .add(length)
      .toZonedDateTimeISO(zone)
      .toString({ timeZoneName: "never" });
  return {
    ...master,
    end: { dateTime: end, timeZone: zone },
    id: `${master.id}_${compact(original)}`,
    originalStartTime: { dateTime: original, timeZone: zone },
    recurrence: undefined,
    recurringEventId: master.id,
    start: { dateTime: moved?.start ?? original, timeZone: zone },
  };
};

const nov16 = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00");

/** A write's answer: the event written, with its id. */
const echo = (request: Request) => ({
  ...request.body,
  id: request.body?.id ?? request.url.pathname.split("/").at(-1),
});

/**
 * A Google calendar holding `master` and its `exceptions`: it lists them
 * by iCalUID, finds a new series' occurrence by its original start, and
 * echoes writes. `answer` answers a request first when it returns one.
 */
const fakeGoogle = (
  master: Event,
  exceptions: Event[] = [],
  answer: (request: Request) => unknown = () => undefined
) =>
  stubGoogle((request) => {
    const answered = answer(request);
    if (answered) {
      return answered;
    }
    const path = request.url.pathname;
    if (request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (request.method !== "GET") {
      return echo(request);
    }
    if (path.endsWith("/events")) {
      return { items: [master, ...exceptions] };
    }
    if (path.endsWith("/instances")) {
      const seriesId = path.split("/").at(-2) ?? "";
      const at = request.url.searchParams.get("originalStart") ?? "";
      return { items: [occurrenceOf({ ...master, id: seriesId }, at)] };
    }
    const id = path.split("/").at(-1);
    return exceptions.find((exception) => exception.id === id) ?? master;
  });

const run = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.runPromiseExit(effect);

/** What a refused write tells the client. */
const refusalOf = async (effect: Effect.Effect<unknown, unknown>) => {
  const error = await Effect.runPromise(Effect.flip(effect));
  return error && typeof error === "object" && "publicError" in error
    ? error.publicError
    : error;
};

const service = () => makeGoogleCalendarService("token");

/** The form saved from `occurrence` with `changes`, for `scope`. */
const edit = (
  scope: "all" | "following",
  occurrence: Event,
  changes: Partial<CreateEvent>
) =>
  service().updateEvent(
    "primary",
    occurrence.id,
    { ...occurrence, ...changes } as CreateEvent,
    scope,
    occurrence
  );

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
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;TZID=America/New_York:20261130T100000",
    ]);
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
      },
      message:
        "This would remove changes made to single occurrences (Nov 23), so it wasn't saved. Change the repeat from a later occurrence, or undo those changes first.",
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

  test("an all-day series made timed counts its days in the new start's zone", async () => {
    // Daily all day Nov 8-12, Nov 10 skipped, made 21:00 New York.
    const master: Event = {
      end: { date: "2026-11-09" },
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
      "EXDATE;TZID=America/New_York:20261110T210000",
    ]);
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
