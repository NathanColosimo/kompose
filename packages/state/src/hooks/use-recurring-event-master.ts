"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { useQuery } from "@tanstack/react-query";
import { useStateConfig } from "../config";
import { getGoogleEventMastersByCalendarQueryKey } from "../google-calendar-query-keys";

function recurringEventMasterQueryKey(params: {
  accountId: string;
  calendarId: string;
  recurringEventId: string;
}) {
  return [
    ...getGoogleEventMastersByCalendarQueryKey(params),
    params.recurringEventId,
  ] as const;
}

export function useRecurringEventMaster(params: {
  accountId: string;
  calendarId: string;
  event: GoogleEvent | null;
  enabled?: boolean;
}) {
  const { orpc } = useStateConfig();

  const shouldFetchByDefault =
    params.event !== null &&
    !params.event.recurrence?.length &&
    Boolean(params.event.recurringEventId);

  const recurringEventId = params.event?.recurringEventId;

  const enabled =
    params.event !== null &&
    Boolean(recurringEventId) &&
    (params.enabled ?? shouldFetchByDefault);

  const queryKey = enabled
    ? recurringEventMasterQueryKey({
        accountId: params.accountId,
        calendarId: params.calendarId,
        recurringEventId: recurringEventId ?? "",
      })
    : ([
        ...getGoogleEventMastersByCalendarQueryKey(params),
        params.event?.id ?? "no-event",
        "disabled",
      ] as const);

  const query = useQuery({
    enabled,
    queryFn: () => {
      if (!recurringEventId) {
        throw new Error("Recurring master query is disabled");
      }
      return orpc.googleCal.events.get({
        accountId: params.accountId,
        calendarId: params.calendarId,
        eventId: recurringEventId,
      });
    },
    queryKey,
    staleTime: 5 * 60 * 1000,
  });
  const refreshing = seriesRefreshing(query);
  return {
    ...query,
    /** A stale series (marked so by a write) is being fetched again. */
    refreshing,
    /** The rule isn't usable yet: first load, or a stale copy refreshing. */
    ruleLoading: query.isLoading || refreshing,
    /** The series' rule can be used: loaded, and not a stale copy being refreshed. */
    ruleReady: Boolean(query.data) && !refreshing,
  };
}

/**
 * Whether a loaded series is a stale copy being fetched again: after a
 * write marks it stale, its old rule mustn't feed a save until the new one
 * is in.
 */
export function seriesRefreshing(query: {
  data?: unknown;
  isFetching: boolean;
  isStale: boolean;
}): boolean {
  return Boolean(query.data) && query.isStale && query.isFetching;
}
