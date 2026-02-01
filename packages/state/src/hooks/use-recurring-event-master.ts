"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { UseQueryOptions } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { getStateConfigFromStore, useStateConfig } from "../config";

/**
 * Shared query-key builder so prefetch + editor always hit the same cache.
 */
function recurringEventMasterQueryKey(params: {
  accountId: string;
  calendarId: string;
  recurringEventId: string;
}) {
  return [
    "google-event-master",
    params.accountId,
    params.calendarId,
    params.recurringEventId,
  ] as const;
}

/**
 * Central query options so all callers (useQuery/prefetch) stay consistent.
 */
export function recurringEventMasterQueryOptions(params: {
  accountId: string;
  calendarId: string;
  recurringEventId: string;
}): UseQueryOptions<
  GoogleEvent,
  Error,
  GoogleEvent,
  ReturnType<typeof recurringEventMasterQueryKey>
> {
  const { orpc } = getStateConfigFromStore();

  return {
    queryKey: recurringEventMasterQueryKey(params),
    queryFn: () =>
      orpc.googleCal.events.get.call({
        accountId: params.accountId,
        calendarId: params.calendarId,
        eventId: params.recurringEventId,
      }),
    staleTime: 5 * 60 * 1000,
  };
}

/**
 * Fetches the recurring master event for a recurring instance.
 */
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
        "google-event-master",
        params.accountId,
        params.calendarId,
        params.event?.id ?? "no-event",
        "disabled",
      ] as const);

  return useQuery({
    queryKey,
    queryFn: () => {
      if (!recurringEventId) {
        throw new Error("Recurring master query is disabled");
      }
      return orpc.googleCal.events.get.call({
        accountId: params.accountId,
        calendarId: params.calendarId,
        eventId: recurringEventId,
      });
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
