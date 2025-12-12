"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

/**
 * Shared query-key builder so prefetch + editor always hit the same cache.
 *
 * Note: `recurringEventId` is only unique within a calendar, so we include
 * `calendarId` in the key.
 */
export function recurringEventMasterQueryKey(params: {
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
}) {
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
 *
 * This is intentionally non-blocking for rendering; callers can use it purely
 * to warm the cache, or to hydrate recurrence editing UI.
 */
export function useRecurringEventMaster(params: {
  accountId: string;
  calendarId: string;
  event: GoogleEvent;
  /** Override default enable behavior if needed. */
  enabled?: boolean;
}) {
  const shouldFetchByDefault =
    !params.event.recurrence?.length && Boolean(params.event.recurringEventId);

  const recurringEventId = params.event.recurringEventId;

  const enabled =
    Boolean(recurringEventId) && (params.enabled ?? shouldFetchByDefault);

  // When disabled, we still use a unique key (includes `event.id`) so we don't
  // accidentally share a disabled key across unrelated events.
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
        params.event.id,
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
