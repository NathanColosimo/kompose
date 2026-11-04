import { describe, expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { QueryClient } from "@tanstack/react-query";
import { getGoogleEventsQueryKey } from "../google-calendar-query-keys";
import { overlappingCachedEvents } from "./use-google-events";

const calendar = { accountId: "account", calendarId: "calendar" };

function event(id: string, summary = id): GoogleEvent {
  return { id, summary } as GoogleEvent;
}

function windowOf(timeMin: string, timeMax: string) {
  return { timeMax: `${timeMax}T00:00:00Z`, timeMin: `${timeMin}T00:00:00Z` };
}

// Padded month windows, as eventWindowAtom builds them.
const november = windowOf("2026-10-17", "2026-12-16");
const december = windowOf("2026-11-16", "2027-01-16");
const january = windowOf("2026-12-17", "2027-02-16");

function cache(
  client: QueryClient,
  window: ReturnType<typeof windowOf>,
  events: GoogleEvent[],
  updatedAt: number
) {
  client.setQueryData(getGoogleEventsQueryKey(calendar, window), events, {
    updatedAt,
  });
}

describe("overlappingCachedEvents", () => {
  test("merges cached windows on both sides of an uncached one", () => {
    const client = new QueryClient();
    cache(client, november, [event("nov-20"), event("dec-10")], 1);
    cache(client, january, [event("dec-27"), event("jan-05")], 2);

    const ids = overlappingCachedEvents(client, calendar, december)?.map(
      (e) => e.id
    );
    expect(ids?.sort()).toEqual(["dec-10", "dec-27", "jan-05", "nov-20"]);
  });

  test("keeps the most recently fetched copy of an event", () => {
    const client = new QueryClient();
    cache(client, november, [event("shared", "old")], 1);
    cache(client, january, [event("shared", "new")], 2);

    expect(overlappingCachedEvents(client, calendar, december)).toEqual([
      event("shared", "new"),
    ]);
  });

  test("returns a single overlapping window's array as is", () => {
    const client = new QueryClient();
    const events = [event("nov-20")];
    cache(client, november, events, 1);

    expect(overlappingCachedEvents(client, calendar, december)).toBe(events);
  });

  test("ignores windows that don't overlap", () => {
    const client = new QueryClient();
    cache(client, windowOf("2027-03-01", "2027-04-01"), [event("mar")], 1);

    expect(overlappingCachedEvents(client, calendar, december)).toBeUndefined();
  });
});
