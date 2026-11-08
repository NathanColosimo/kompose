/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import { Effect, Exit } from "effect";

const zone = "America/New_York";

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
 * `failure`), and every request is recorded. The client takes fetch when
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

const isList = (request: Request) =>
  request.method === "GET" && request.url.pathname.endsWith("/events");

/** A weekly Monday 9:00 New York series from Nov 9, 2026. */
const weekly: Event = {
  end: { dateTime: "2026-11-09T09:30:00-05:00", timeZone: zone },
  iCalUID: "series@google.com",
  id: "series",
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
  start: { dateTime: "2026-11-09T09:00:00-05:00", timeZone: zone },
  summary: "Planning",
};

/** `master`'s occurrence at `start` (an ISO date-time), as Google lists it. */
const occurrenceOf = (master: Event, start: string, end: string): Event => ({
  ...master,
  end: { dateTime: end, timeZone: zone },
  id: `${master.id}_${start}`,
  originalStartTime: { dateTime: start, timeZone: zone },
  recurrence: undefined,
  recurringEventId: master.id,
  start: { dateTime: start, timeZone: zone },
});

const nov16 = occurrenceOf(
  weekly,
  "2026-11-16T09:00:00-05:00",
  "2026-11-16T09:30:00-05:00"
);

/** A write's answer: the event written, with its id. */
const echo = (request: Request) => ({
  ...request.body,
  id: request.method === "POST" ? "new" : "series",
});

/** Google: the master, its exceptions by iCalUID, and writes echoed back. */
const seriesGoogle = (master: Event, exceptions: Event[] = []) =>
  stubGoogle((request) => {
    if (isList(request)) {
      return { items: [master, ...exceptions] };
    }
    return request.method === "GET" ? master : echo(request);
  });

const run = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.runPromiseExit(effect);

describe("This and following", () => {
  const editFollowing = (occurrence: Event, edit: Partial<CreateEvent>) =>
    makeGoogleCalendarService("token").updateEvent(
      "primary",
      occurrence.id,
      { ...occurrence, ...edit } as CreateEvent,
      "following",
      occurrence
    );

  test("ends the old series the second before and starts the new one there", async () => {
    const google = seriesGoogle(weekly);
    // Written without an offset, in its zone.
    const exit = await run(
      editFollowing(nov16, {
        end: { dateTime: "2026-11-23T09:30:00", timeZone: zone },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
        start: { dateTime: "2026-11-23T09:00:00", timeZone: zone },
        summary: "Planning (new room)",
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const [cut, created] = google.writes();
    expect(cut?.method).toBe("PUT");
    expect(cut?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T135959Z",
    ]);
    expect(cut?.body?.summary).toBe("Planning");
    expect(created?.method).toBe("POST");
    expect(created?.body).toMatchObject({
      end: { dateTime: "2026-11-23T09:30:00-05:00", timeZone: zone },
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      start: { dateTime: "2026-11-23T09:00:00-05:00", timeZone: zone },
      summary: "Planning (new room)",
    });
    // A new event can't take the old series' iCalUID.
    expect(created?.body).not.toHaveProperty("iCalUID");
    expect(google.writes()).toHaveLength(2);
  });

  test("a start written in another zone, without an offset, keeps its moment", async () => {
    // 09:00 Tokyo on Nov 23 is 19:00 New York on Nov 22 (the series' zone).
    const google = seriesGoogle(weekly);
    const exit = await run(
      editFollowing(nov16, {
        end: { dateTime: "2026-11-23T09:30:00", timeZone: "Asia/Tokyo" },
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"],
        start: { dateTime: "2026-11-23T09:00:00", timeZone: "Asia/Tokyo" },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.writes()[1]?.body).toMatchObject({
      end: { dateTime: "2026-11-22T19:30:00-05:00", timeZone: zone },
      start: { dateTime: "2026-11-22T19:00:00-05:00", timeZone: zone },
    });
  });

  test("keeps an occurrence deleted after the split skipped in the new series", async () => {
    // Nov 30 and Nov 9 were deleted one at a time (cancelled exceptions,
    // not EXDATEs). Split at Nov 16 and moved to 10:00: Nov 30 stays
    // skipped, at the new time; Nov 9 belongs to the old part.
    const cancelled = (start: string, end: string): Event => ({
      ...occurrenceOf(weekly, start, end),
      status: "cancelled",
    });
    const google = seriesGoogle(weekly, [
      cancelled("2026-11-09T09:00:00-05:00", "2026-11-09T09:30:00-05:00"),
      cancelled("2026-11-30T09:00:00-05:00", "2026-11-30T09:30:00-05:00"),
    ]);
    const exit = await run(
      editFollowing(nov16, {
        end: { dateTime: "2026-11-16T10:30:00-05:00", timeZone: zone },
        start: { dateTime: "2026-11-16T10:00:00-05:00", timeZone: zone },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(google.requests.find(isList)?.url.searchParams.get("iCalUID")).toBe(
      "series@google.com"
    );
    expect(google.writes()[1]?.body?.recurrence).toEqual([
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;TZID=America/New_York:20261130T100000",
    ]);
  });

  test("puts the old series back when the new one can't be created", async () => {
    const google = stubGoogle((request) => {
      if (isList(request)) {
        return { items: [] };
      }
      if (request.method === "POST") {
        return failure(400);
      }
      return request.method === "GET" ? weekly : echo(request);
    });
    const exit = await run(
      editFollowing(nov16, { summary: "Planning (new room)" })
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const writes = google.writes();
    expect(writes.map((write) => write.method)).toEqual(["PUT", "POST", "PUT"]);
    expect(writes[2]?.body?.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  });

  test("puts the old series back when Google's answer to the cut can't be read", async () => {
    const google = stubGoogle((request) => {
      if (isList(request)) {
        return { items: [] };
      }
      // No id: not an event.
      return request.method === "GET" ? weekly : { status: "confirmed" };
    });
    const exit = await run(
      editFollowing(nov16, { summary: "Planning (new room)" })
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const writes = google.writes();
    expect(writes.map((write) => write.method)).toEqual(["PUT", "PUT"]);
    expect(writes[1]?.body?.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  });

  test("a move to another calendar puts the old series back on failure too", async () => {
    const google = stubGoogle((request) => {
      if (isList(request)) {
        return { items: [] };
      }
      if (request.method === "POST") {
        return failure(403);
      }
      return request.url.pathname.endsWith(nov16.id) ? nov16 : weekly;
    });
    const exit = await run(
      makeGoogleCalendarService("token").moveEvent(
        "primary",
        nov16.id,
        "work",
        "following"
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const writes = google.writes();
    expect(writes.map((write) => write.method)).toEqual(["PUT", "POST", "PUT"]);
    expect(writes[1]?.url.pathname).toContain("/calendars/work/");
    expect(writes[2]?.body?.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
  });
});

describe("Entire series", () => {
  const editAll = (occurrence: Event, edit: Partial<CreateEvent>) =>
    makeGoogleCalendarService("token").updateEvent(
      "primary",
      occurrence.id,
      { ...occurrence, ...edit } as CreateEvent,
      "all",
      occurrence
    );

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
    const google = seriesGoogle(master);
    const exit = await run(
      editAll(master, {
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
    const google = seriesGoogle(master);
    const exit = await run(
      editAll(master, {
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
    const first = occurrenceOf(
      weekly,
      "2026-11-09T09:00:00-05:00",
      "2026-11-09T09:30:00-05:00"
    );
    const google = seriesGoogle(weekly);
    const exit = await run(
      editAll(first, {
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
    const google = seriesGoogle(weekly);
    const exit = await run(
      editAll(nov16, {
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
});
