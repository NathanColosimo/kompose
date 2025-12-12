"use client";

import type {
  CreateEvent,
  Event,
  RecurrenceScope,
} from "@kompose/google-cal/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

export type UpdateGoogleEventInput = {
  accountId: string;
  calendarId: string;
  targetCalendarId?: string;
  eventId: string;
  recurringEventId?: string | null;
  recurrenceScope?: RecurrenceScope;
  event: Event;
};

// Minimal sanitization to fit CreateEvent input (server handles recurrence logic).
function sanitizeEventPayload(event: Event): CreateEvent {
  const {
    id: _id,
    htmlLink: _htmlLink,
    organizer: _organizer,
    ...rest
  } = event;
  return rest;
}

/**
 * Google event update mutation (delegates recurrence logic to backend).
 */
export function useUpdateGoogleEventMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: UpdateGoogleEventInput) =>
      orpc.googleCal.events.update.call({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        eventId: variables.eventId,
        event: sanitizeEventPayload(variables.event),
        scope: variables.recurrenceScope ?? "this",
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: orpc.googleCal.events.key(),
      });

      const previousQueries = queryClient.getQueriesData({
        queryKey: orpc.googleCal.events.key(),
      });

      return { previousQueries };
    },
    onError: (err, _variables, context) => {
      toast.error(err.message);

      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orpc.googleCal.events.key() });
    },
  });
}
