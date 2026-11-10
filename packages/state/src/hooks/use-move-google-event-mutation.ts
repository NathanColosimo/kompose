"use client";

import type { MoveEventInput } from "@kompose/api/routers/google-cal/contract";
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { type StateConfig, useStateConfig } from "../config";
import { invalidateGoogleEventQueries } from "../google-calendar-query-keys";
import {
  HELD_WRITE_NETWORK_MODE,
  type HeldSave,
  reportHeldSaveFailure,
} from "../held-save";

export function useMoveGoogleEventMutation() {
  return useMutation(
    moveGoogleEventMutationOptions(useQueryClient(), useStateConfig())
  );
}

/**
 * A calendar move. Nothing changes in the cache before the server answers;
 * either way, both calendars' events and series are refetched. A failure
 * is reported unless the editor holding the save says it (`quiet`).
 */
export function moveGoogleEventMutationOptions(
  queryClient: QueryClient,
  { notifyError, orpc }: Pick<StateConfig, "notifyError" | "orpc">
) {
  return {
    networkMode: HELD_WRITE_NETWORK_MODE,
    mutationFn: async ({
      failureMessage: _failureMessage,
      quiet: _quiet,
      ...variables
    }: MoveEventInput & HeldSave) => orpc.googleCal.events.move(variables),
    onError: (err: Error, variables: MoveEventInput & HeldSave) => {
      reportHeldSaveFailure(notifyError, err, variables);
    },
    onSettled: (
      _data: unknown,
      _error: Error | null,
      variables: MoveEventInput & HeldSave
    ) => {
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
