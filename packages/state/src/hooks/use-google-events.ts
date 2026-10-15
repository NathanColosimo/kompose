"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
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

  const queries = useQueries({
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

  const events: GoogleEventWithSource[] = queries.flatMap((query, index) => {
    const calendar = visibleCalendars[index];
    if (!(calendar && query.data)) {
      return [];
    }
    return query.data.map((event) => ({
      accountId: calendar.accountId,
      calendarId: calendar.calendarId,
      event,
    }));
  });

  const isLoading = queries.some((q) => q.isLoading);
  const isFetching = queries.some((q) => q.isFetching);

  return { events, isFetching, isLoading };
}
