"use client";

import type { MoveEventInput } from "@kompose/api/routers/google-cal/contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStateConfig } from "../config";
import { getGoogleEventsByCalendarQueryKey } from "../google-calendar-query-keys";

/**
 * Google event move mutation (supports recurrence scope).
 */
export function useMoveGoogleEventMutation() {
  const queryClient = useQueryClient();
  const { orpc, notifyError } = useStateConfig();

  return useMutation({
    mutationFn: async (variables: MoveEventInput) =>
      orpc.googleCal.events.move(variables),
    onMutate: async (variables) => {
      // Snapshot both calendars for "move" operations. The destination is only
      // read when it differs from the source, so the two lists never overlap.
      const sourceKey = getGoogleEventsByCalendarQueryKey({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
      });
      const destinationKey = getGoogleEventsByCalendarQueryKey({
        accountId: variables.accountId,
        calendarId: variables.destinationCalendarId,
      });

      await queryClient.cancelQueries({
        queryKey: sourceKey,
      });
      if (variables.destinationCalendarId !== variables.calendarId) {
        await queryClient.cancelQueries({
          queryKey: destinationKey,
        });
      }

      const sourceQueries = queryClient.getQueriesData({
        queryKey: sourceKey,
      });
      const destinationQueries =
        variables.destinationCalendarId === variables.calendarId
          ? []
          : queryClient.getQueriesData({
              queryKey: destinationKey,
            });

      return {
        previousQueries: [...sourceQueries, ...destinationQueries],
      };
    },
    onError: (err, _variables, context) => {
      notifyError?.(err);

      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
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
