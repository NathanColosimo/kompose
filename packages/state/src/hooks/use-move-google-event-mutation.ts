"use client";

import type { MoveEventInput } from "@kompose/api/routers/google-cal/contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStateConfig } from "../config";
import { getGoogleEventsByCalendarQueryKey } from "../google-calendar-query-keys";

export function useMoveGoogleEventMutation() {
  const queryClient = useQueryClient();
  const { orpc, notifyError } = useStateConfig();

  return useMutation({
    mutationFn: async (variables: MoveEventInput) =>
      orpc.googleCal.events.move(variables),
    onError: (err) => {
      notifyError?.(err);
    },
    onSettled: (_data, _error, variables) => {
      if (!variables) {
        return;
      }

      queryClient.invalidateQueries({
        queryKey: getGoogleEventsByCalendarQueryKey({
          accountId: variables.accountId,
          calendarId: variables.calendarId,
        }),
      });
      queryClient.invalidateQueries({
        queryKey: getGoogleEventsByCalendarQueryKey({
          accountId: variables.accountId,
          calendarId: variables.destinationCalendarId,
        }),
      });
    },
  });
}
