"use client";

import type { RecurrenceScope } from "@kompose/google-cal/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStateConfig } from "../config";

interface MoveGoogleEventInput {
  accountId: string;
  calendarId: string;
  eventId: string;
  destinationCalendarId: string;
  scope: RecurrenceScope;
}

/**
 * Google event move mutation (supports recurrence scope).
 */
export function useMoveGoogleEventMutation() {
  const queryClient = useQueryClient();
  const { orpc, notifyError } = useStateConfig();

  return useMutation({
    mutationFn: async (variables: MoveGoogleEventInput) =>
      orpc.googleCal.events.move.call({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        eventId: variables.eventId,
        destinationCalendarId: variables.destinationCalendarId,
        scope: variables.scope,
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
      notifyError?.(err);

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
