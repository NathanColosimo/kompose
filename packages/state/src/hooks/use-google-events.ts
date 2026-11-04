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
 * Placeholder events for `calendar` while `window` loads: the cached events of
 * every window that overlaps it, the most recently fetched copy of each event
 * winning.
 *
 * `useQueries` matches observers by query key, so a new window gets a new
 * observer and `keepPreviousData` has nothing to keep. Merging matters when
 * both neighbouring months are cached: either one alone leaves half the month
 * empty.
 */
export function overlappingCachedEvents(
  queryClient: QueryClient,
  calendar: CalendarIdentifier,
  window: GoogleEventsWindow
): GoogleEvent[] | undefined {
  const start = Date.parse(window.timeMin);
  const end = Date.parse(window.timeMax);
  const events = queryClient
    .getQueryCache()
    .findAll({
      predicate: ({ queryKey }) => {
        const [, , , timeMin, timeMax] = queryKey as ReturnType<
          typeof getGoogleEventsQueryKey
        >;
        return Date.parse(timeMin) < end && Date.parse(timeMax) > start;
      },
      queryKey: getGoogleEventsByCalendarQueryKey(calendar),
    })
    // Oldest first, so newer copies overwrite older ones in `byId` below.
    .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)
    .flatMap((query) => (query.state.data as GoogleEvent[] | undefined) ?? []);
  if (events.length === 0) {
    return;
  }
  const byId = new Map(events.map((event) => [event.id, event]));
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
