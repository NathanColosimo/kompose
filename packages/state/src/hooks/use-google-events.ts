"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  keepPreviousData,
  type UseQueryResult,
  useQueries,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type { CalendarIdentifier } from "../atoms/visible-calendars";
import { useStateConfig } from "../config";
import { getGoogleEventsQueryKey } from "../google-calendar-query-keys";

export interface GoogleEventWithSource {
  accountId: string;
  calendarId: string;
  event: GoogleEvent;
}

/**
 * Fetch Google events for each selected calendar within a shared time window.
 */
export function useGoogleEvents({
  visibleCalendars,
  window,
}: {
  visibleCalendars: CalendarIdentifier[];
  window: { timeMin: string; timeMax: string };
}) {
  const { orpc } = useStateConfig();

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
      placeholderData: keepPreviousData,
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
