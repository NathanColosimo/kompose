"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  type QueryClient,
  type UseQueryResult,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type { CalendarIdentifier } from "../atoms/visible-calendars";
import { useStateConfig } from "../config";
import {
  type GoogleEventsWindow,
  getGoogleEventsByCalendarQueryKey,
  getGoogleEventsQueryKey,
} from "../google-calendar-query-keys";

export interface GoogleEventWithSource {
  accountId: string;
  calendarId: string;
  event: GoogleEvent;
}

/**
 * Placeholder events for `calendar` while `window` loads: the cached events
 * from every window that overlaps it, keeping the most recently fetched copy
 * of each event.
 *
 * `useQueries` matches observers by query key, so when the window changes each
 * calendar gets a new observer and `keepPreviousData` has nothing to keep: the
 * grid went blank until the new window loaded. Windows are padded months, so
 * cached neighbours usually cover the days on screen. Merging matters when
 * both neighbours are cached (load November, jump to January, then step back
 * to December): either one alone would leave half of December empty.
 */
export function overlappingCachedEvents(
  queryClient: QueryClient,
  calendar: CalendarIdentifier,
  window: GoogleEventsWindow
): GoogleEvent[] | undefined {
  const start = Date.parse(window.timeMin);
  const end = Date.parse(window.timeMax);
  const overlapping = queryClient
    .getQueryCache()
    .findAll({ queryKey: getGoogleEventsByCalendarQueryKey(calendar) })
    .filter((query) => {
      const [, , , timeMin, timeMax] = query.queryKey as ReturnType<
        typeof getGoogleEventsQueryKey
      >;
      return (
        query.state.data !== undefined &&
        Date.parse(timeMin) < end &&
        Date.parse(timeMax) > start
      );
    })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);

  const [newest] = overlapping;
  if (overlapping.length <= 1) {
    // Hand back the cached array itself so its reference stays stable.
    return newest?.state.data as GoogleEvent[] | undefined;
  }
  const byId = new Map<string, GoogleEvent>();
  for (const query of overlapping) {
    for (const event of query.state.data as GoogleEvent[]) {
      if (!byId.has(event.id)) {
        byId.set(event.id, event);
      }
    }
  }
  return [...byId.values()];
}

/**
 * Fetch Google events for each selected calendar within a shared time window.
 */
export function useGoogleEvents({
  visibleCalendars,
  window,
}: {
  visibleCalendars: CalendarIdentifier[];
  window: GoogleEventsWindow;
}) {
  const { orpc } = useStateConfig();
  const queryClient = useQueryClient();

  // TanStack structurally shares the combined result, so `events` keeps its
  // identity across fetch-status changes and refetches that return the same
  // data. Without this, every refetch handed the grid a new array and it
  // re-laid out every event in the window.
  const combine = useCallback(
    (queries: UseQueryResult<GoogleEvent[]>[]) => ({
      events: queries.flatMap((query, index): GoogleEventWithSource[] => {
        const calendar = visibleCalendars[index];
        if (!(calendar && query.data)) {
          return [];
        }
        return query.data.map((event) => ({
          accountId: calendar.accountId,
          calendarId: calendar.calendarId,
          event,
        }));
      }),
      isFetching: queries.some((query) => query.isFetching),
      isLoading: queries.some((query) => query.isLoading),
    }),
    [visibleCalendars]
  );

  return useQueries({
    combine,
    queries: visibleCalendars.map((calendar) => ({
      placeholderData: () =>
        overlappingCachedEvents(queryClient, calendar, window),
      queryFn: async () =>
        await orpc.googleCal.events.list({
          accountId: calendar.accountId,
          calendarId: calendar.calendarId,
          params: {
            timeMax: window.timeMax,
            timeMin: window.timeMin,
          },
        }),
      queryKey: getGoogleEventsQueryKey(calendar, window),
      staleTime: 60_000,
    })),
  });
}
