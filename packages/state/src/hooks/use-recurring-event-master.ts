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
    // The editors show a failed load beside Repeat, with a retry.
    meta: { quietError: true },
    queryKey,
    staleTime: 5 * 60 * 1000,
  });
  const ready = seriesRuleReady(query);
  // Only the fields callers read: spreading the query would track (and
  // re-render on) every one of its fields.
  return {
    data: query.data,
    ruleReady: ready,
    /**
     * An occurrence's series rule that can't be used now (loading, or its
     * load failed): its repeat can't be edited from it.
     */
    ruleUnavailable: enabled && !ready,
    /**
     * The series' rule couldn't be loaded: unavailable, failed, and no
     * fetch running (a retry in flight shows as loading again).
     */
    ruleFailed: enabled && !ready && query.isError && !query.isFetching,
    /** Its fetch waits for the network: it loads once back online. */
    rulePaused: enabled && query.isPaused,
    /** Load the series again (after it failed). */
    retry: () => {
      query.refetch().catch(() => undefined);
    },
  };
}

/**
 * Whether the series' rule can be used: loaded, and not a stale copy being
 * fetched again or one whose fetch failed (its old rule stays unusable).
 */
export function seriesRuleReady(query: {
  data?: unknown;
  isFetching: boolean;
  isPaused?: boolean;
  isRefetchError: boolean;
  isStale: boolean;
}): boolean {
  return (
    Boolean(query.data) &&
    !(query.isStale && (query.isFetching || query.isPaused)) &&
    !query.isRefetchError
  );
}
