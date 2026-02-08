"use client";

import type { Calendar } from "@kompose/google-cal/schema";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useStateConfig } from "../config";
import { getGoogleCalendarsQueryKey } from "../google-calendar-query-keys";

export interface CalendarWithSource {
  accountId: string;
  calendar: Calendar;
}

/**
 * Fetch calendars for each linked Google account.
 */
export function useGoogleCalendars(accountIds: string[]) {
  const { orpc } = useStateConfig();

  const queries = useQueries({
    queries: accountIds.map((accountId) => ({
      queryKey: getGoogleCalendarsQueryKey(accountId),
      queryFn: async () => await orpc.googleCal.calendars.list({ accountId }),
      placeholderData: keepPreviousData,
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Memoize flattened calendars to keep a stable reference when data is unchanged.
  const calendars = useMemo<CalendarWithSource[]>(() => {
    return queries.flatMap((query, index) => {
      const accountId = accountIds[index];
      if (!(accountId && query.data)) {
        return [];
      }
      return query.data.map((calendar) => ({ accountId, calendar }));
    });
  }, [accountIds, queries]);

  const isLoading = queries.some((q) => q.isLoading);
  const isFetching = queries.some((q) => q.isFetching);

  return { calendars, isLoading, isFetching };
}
