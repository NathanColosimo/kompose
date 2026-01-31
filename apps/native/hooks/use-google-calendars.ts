import type { Calendar } from "@kompose/google-cal/schema";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

export interface CalendarWithSource {
  accountId: string;
  calendar: Calendar;
}

/**
 * Fetch calendars for each linked Google account.
 *
 * Returns a flattened list of `{ accountId, calendar }` for convenience.
 */
export function useGoogleCalendars(accountIds: string[]) {
  const queries = useQueries({
    queries: accountIds.map((accountId) => ({
      ...orpc.googleCal.calendars.list.queryOptions({
        input: { accountId },
      }),
      queryKey: ["google-calendars", accountId],
      placeholderData: keepPreviousData,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const calendars: CalendarWithSource[] = queries.flatMap((query, index) => {
    const accountId = accountIds[index];
    if (!(accountId && query.data)) {
      return [];
    }
    return query.data.map((calendar) => ({ accountId, calendar }));
  });

  const isLoading = queries.some((q) => q.isLoading);
  const isFetching = queries.some((q) => q.isFetching);

  return { calendars, isLoading, isFetching };
}
