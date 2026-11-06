"use client";

import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import { useQuery } from "@tanstack/react-query";
import { useStateConfig } from "../config";

export function useRecurringEventMaster(params: {
  accountId: string;
  calendarId: string;
  event: GoogleEvent | null;
  enabled?: boolean;
}) {
  const { orpc } = useStateConfig();

  const recurringEventId = params.event?.recurringEventId;

  return useQuery({
    enabled:
      Boolean(recurringEventId) &&
      !params.event?.recurrence?.length &&
      (params.enabled ?? true),
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
    // Keep the cache identity stable when the editor opens and closes.
    queryKey: [
      "google-event-master",
      params.accountId,
      params.calendarId,
      recurringEventId ?? "no-master",
    ],
    staleTime: 5 * 60 * 1000,
  });
}
