"use client";

import type { RecurrenceScope } from "@kompose/google-cal/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStateConfig } from "../config";
import { getGoogleEventsByCalendarQueryKey } from "../google-calendar-query-keys";

interface MoveGoogleEventInput {
  accountId: string;
  calendarId: string;
  eventId: string;
  destinationCalendarId: string;
  scope: RecurrenceScope;
}

function mergeQuerySnapshots(
  left: readonly [readonly unknown[], unknown][],
  right: readonly [readonly unknown[], unknown][]
) {
  const deduped = new Map<string, readonly [readonly unknown[], unknown]>();

  for (const item of [...left, ...right]) {
    deduped.set(JSON.stringify(item[0]), item);
  }

  return Array.from(deduped.values());
}

/**
 * Google event move mutation (supports recurrence scope).
 */
export function useMoveGoogleEventMutation() {
  const queryClient = useQueryClient();
  const { orpc, notifyError } = useStateConfig();

  return useMutation({
    mutationFn: async (variables: MoveGoogleEventInput) =>
      orpc.googleCal.events.move({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        eventId: variables.eventId,
        destinationCalendarId: variables.destinationCalendarId,
        scope: variables.scope,
      }),
    onMutate: async (variables) => {
      // Invalidate both calendars for "move" operations.
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
        previousQueries: mergeQuerySnapshots(sourceQueries, destinationQueries),
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
