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
 * by iCalUID, finds a series it created's occurrence by its original
 * start, and echoes writes. `answer` answers a request first when it
 * returns one.
 */
const fakeGoogle = (
  master: Event,
  exceptions: Event[] = [],
  answer: (request: Request) => unknown = () => undefined
) => {
  const created = new Map<string, Event>();
  return stubGoogle((request) => {
    const answered = answer(request);
    if (answered) {
      return answered;
    }
    const path = request.url.pathname;
    if (request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && path.endsWith("/move")) {
      return master;
    }
    if (request.method === "POST") {
      const series = echo(request) as Event;
      created.set(series.id, series);
      return series;
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
      const series = created.get(seriesId) ?? { ...master, id: seriesId };
      return { items: [occurrenceOf(series, at)] };
    }
    const id = path.split("/").at(-1);
    return exceptions.find((exception) => exception.id === id) ?? master;
  });
};

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
        "This would undo changes made to single occurrences (Nov 23), so it wasn't saved. Save it with This and following from a later occurrence, or undo those changes first.",
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
    expect(google.writes()[0]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;TZID=America/New_York:20261130T100000",
    ]);
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

  test("clearing a field the series has clears it for the series", async () => {
    const noted = { ...weekly, description: "Agenda in the doc" };
    const opened = occurrenceOf(noted, "2026-11-16T09:00:00-05:00");
    const google = fakeGoogle(noted);
    expect(
      Exit.isSuccess(await run(edit("all", opened, { description: "" })))
    ).toBe(true);
    expect(google.writes()[0]?.body?.description).toBe("");
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

  test("This and following from the first meeting is refused with meetings added before it", async () => {
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
        edit("following", occurrenceOf(series, "2026-11-09T09:00:00-05:00"), {
          summary: "Planning (new)",
        })
      )
    ).toMatchObject({ data: { reason: "addedBeforeStart" } });
    expect(google.writes()).toEqual([]);
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

  test("either is refused with meetings added before it", async () => {
    const series = {
      ...weekly,
      recurrence: [
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "RDATE;TZID=America/New_York:20261105T090000",
      ],
    };
    const opened = occurrenceOf(series, "2026-11-09T09:00:00-05:00");
    const google = fakeGoogle(series, [opened]);
    const refusals = await Promise.all([
      refusalOf(service().deleteEvent("primary", opened.id, "following")),
      refusalOf(service().moveEvent("primary", opened.id, "work", "following")),
    ]);
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({ data: { reason: "addedBeforeStart" } });
    }
    expect(google.writes()).toEqual([]);
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
      "RDATE;TZID=America/New_York:20261116T090000,20261123T090000",
      "EXDATE;TZID=America/New_York:20261123T090000",
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
      recurrence: [
        "RDATE;TZID=America/New_York:20261116T090000,20261123T090000",
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
