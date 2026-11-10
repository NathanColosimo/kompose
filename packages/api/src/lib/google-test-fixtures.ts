/**
 * A fake Google Calendar for the series write tests: it records every
 * request, lists a series' exceptions, and finds a new series'
 * occurrences.
 */
import { afterEach } from "bun:test";
import { makeGoogleCalendarService } from "@kompose/google-cal/client";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";

export const zone = "America/New_York";

export interface Request {
  body: Record<string, unknown> | null;
  method: string;
  url: URL;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Google failing a request with `status`. */
export const failure = (status: number) =>
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
export const weekly: Event = {
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
export const occurrenceOf = (
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

export const nov16 = occurrenceOf(weekly, "2026-11-16T09:00:00-05:00");

/** A write's answer: the event written, with its id. */
const echo = (request: Request) => ({
  ...request.body,
  id: request.body?.id ?? request.url.pathname.split("/").at(-1),
});

/**
 * A series as Google lists it by iCalUID: its master and exceptions,
 * deleted ones only when asked for.
 */
const listed = (query: URLSearchParams, series: Event[]) => {
  if (query.get("iCalUID") !== series[0]?.iCalUID) {
    return { items: [] };
  }
  const showDeleted = query.get("showDeleted") === "true";
  return {
    items: series.filter(
      (event) => showDeleted || event.status !== "cancelled"
    ),
  };
};

/**
 * A Google calendar holding `master` and its `exceptions`: it lists them
 * by iCalUID, finds a series it created's occurrence by its original
 * start, and echoes writes. `answer` answers a request first when it
 * returns one.
 */
export const fakeGoogle = (
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
      return listed(request.url.searchParams, [master, ...exceptions]);
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

export const run = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.runPromiseExit(effect);

/** What a refused write tells the client. */
export const refusalOf = async (effect: Effect.Effect<unknown, unknown>) => {
  const error = await Effect.runPromise(Effect.flip(effect));
  return error && typeof error === "object" && "publicError" in error
    ? error.publicError
    : error;
};

export const service = () => makeGoogleCalendarService("token");

/** The form saved from `occurrence` with `changes`, for `scope`. */
export const edit = (
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
