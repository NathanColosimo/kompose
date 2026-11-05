"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { type UseQueryResult, useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { CalendarIdentifier } from "../atoms/visible-calendars";
import { useStateConfig } from "../config";
import {
  type GoogleEventsWindow,
  getGoogleEventsQueryKey,
} from "../google-calendar-query-keys";

export interface GoogleEventWithSource {
  accountId: string;
  calendarId: string;
  event: GoogleEvent;
}

/**
 * Fetch Google events for each selected calendar in each of `windows` (the
 * month windows from `eventWindowsAtom`), one query per calendar and month.
 */
export function useGoogleEvents({
  visibleCalendars,
  windows,
}: {
  visibleCalendars: CalendarIdentifier[];
  windows: GoogleEventsWindow[];
}) {
  const { orpc } = useStateConfig();

  const sources = useMemo(
    () =>
      visibleCalendars.flatMap((calendar) =>
        windows.map((window) => ({ calendar, window }))
      ),
    [visibleCalendars, windows]
  );

  // Structural sharing keeps the events array stable when data is unchanged,
  // avoiding unnecessary calendar layout work on refetch.
  const combine = useCallback(
    (queries: UseQueryResult<GoogleEvent[]>[]) => {
      // An event that crosses a month boundary is in both months' results.
      const events = new Map<string, GoogleEventWithSource>();
      queries.forEach((query, index) => {
        const source = sources[index];
        if (!(source && query.data)) {
          return;
        }
        const { accountId, calendarId } = source.calendar;
        for (const event of query.data) {
          events.set(`${accountId}:${calendarId}:${event.id}`, {
            accountId,
            calendarId,
            event,
          });
        }
      });
      return {
        events: [...events.values()],
        isFetching: queries.some((query) => query.isFetching),
        isLoading: queries.some((query) => query.isLoading),
      };
    },
    [sources]
  );

  return useQueries({
    combine,
    queries: sources.map(({ calendar, window }) => ({
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
