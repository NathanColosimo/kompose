"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { useQuery } from "@tanstack/react-query";
import { useStateConfig } from "../config";

/**
 * Query key for a recurring series master event.
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
}
