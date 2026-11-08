"use client";

import type { MoveEventInput } from "@kompose/api/routers/google-cal/contract";
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { type StateConfig, useStateConfig } from "../config";
import {
  getGoogleEventsByCalendarQueryKey,
  invalidateGoogleEventQueries,
} from "../google-calendar-query-keys";
import { type HeldSave, reportHeldSaveFailure } from "../held-save";

export function useMoveGoogleEventMutation() {
  return useMutation(
    moveGoogleEventMutationOptions(useQueryClient(), useStateConfig())
  );
}

/**
 * A calendar move: the source and destination lists roll back on failure,
 * which is reported unless the editor holding the save says it (`quiet`).
 */
export function moveGoogleEventMutationOptions(
  queryClient: QueryClient,
  { notifyError, orpc }: Pick<StateConfig, "notifyError" | "orpc">
) {
  return {
    mutationFn: async ({
      failureMessage: _failureMessage,
      quiet: _quiet,
      ...variables
    }: MoveEventInput & HeldSave) => orpc.googleCal.events.move(variables),
    onMutate: async (variables: MoveEventInput & HeldSave) => {
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
    onError: (
      err: Error,
      variables: MoveEventInput & HeldSave,
      context: { previousQueries: [readonly unknown[], unknown][] } | undefined
    ) => {
      reportHeldSaveFailure(notifyError, err, variables);

      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: (
      _data: unknown,
      _error: Error | null,
      variables: MoveEventInput & HeldSave
    ) => {
      if (!variables) {
        return;
      }

      invalidateGoogleEventQueries(queryClient, [
        { accountId: variables.accountId, calendarId: variables.calendarId },
        {
          accountId: variables.accountId,
          calendarId: variables.destinationCalendarId,
        },
      ]);
    },
  };
}
