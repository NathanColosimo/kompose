"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  type QueryClient,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
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
 * The cached events of `calendar` from the window that overlaps `window` most.
 *
 * `useQueries` matches observers by query key, so when the window changes each
 * calendar gets a new observer and `keepPreviousData` has nothing to keep: the
 * grid went blank until the new window loaded. Windows are padded months, so
 * the previous one usually covers the days on screen.
 */
function overlappingCachedEvents(
  queryClient: QueryClient,
  calendar: CalendarIdentifier,
  window: GoogleEventsWindow
) {
  const start = Date.parse(window.timeMin);
  const end = Date.parse(window.timeMax);
  let best: GoogleEvent[] | undefined;
  let bestOverlap = 0;
  const cached = queryClient.getQueriesData<GoogleEvent[]>({
    queryKey: getGoogleEventsByCalendarQueryKey(calendar),
  });
  for (const [queryKey, data] of cached) {
    const [, , , timeMin, timeMax] = queryKey as ReturnType<
      typeof getGoogleEventsQueryKey
    >;
    const overlap =
      Math.min(end, Date.parse(timeMax)) - Math.max(start, Date.parse(timeMin));
    if (data && overlap > bestOverlap) {
      best = data;
      bestOverlap = overlap;
    }
  }
  return best;
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

  const queries = useQueries({
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
