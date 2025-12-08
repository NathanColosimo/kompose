"use client";

import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

function extractTimeWindowFromQueryKey(queryKey: QueryKey) {
  for (const part of queryKey) {
    if (
      part &&
      typeof part === "object" &&
      "timeMin" in part &&
      "timeMax" in part
    ) {
      const maybe = part as Record<string, unknown>;
      if (
        typeof maybe.timeMin === "string" &&
        typeof maybe.timeMax === "string"
      ) {
        return {
          timeMin: maybe.timeMin,
          timeMax: maybe.timeMax,
        };
      }
    }
  }
  return null;
}

function isoWithinWindow(
  iso: string | undefined,
  window: { timeMin: string; timeMax: string }
) {
  if (!iso) {
    return false;
  }
  const ts = Date.parse(iso);
  const min = Date.parse(window.timeMin);
  const max = Date.parse(window.timeMax);
  if (Number.isNaN(ts) || Number.isNaN(min) || Number.isNaN(max)) {
    return false;
  }
  return ts >= min && ts <= max;
}

/**
 * Google event update mutation with optimistic cache patch per time window.
 */
export function useUpdateGoogleEventMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    ...orpc.googleCal.events.update.mutationOptions(),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: orpc.googleCal.events.key(),
      });

      const previousQueries = queryClient.getQueriesData({
        queryKey: orpc.googleCal.events.key(),
      });

      const updatedKeys: QueryKey[] = [];
      const windowKeysForNewStart: QueryKey[] = [];
      const newStartIso =
        variables.event.start.dateTime ?? variables.event.start.date;

      for (const [queryKey, data] of previousQueries) {
        const window = extractTimeWindowFromQueryKey(queryKey as QueryKey);
        if (window && isoWithinWindow(newStartIso, window)) {
          windowKeysForNewStart.push(queryKey as QueryKey);
        }

        if (!Array.isArray(data)) {
          continue;
        }

        let found = false;
        const next = data.map((event) => {
          if (!(event && typeof event === "object" && "id" in event)) {
            return event;
          }
          const record = event as Record<string, unknown>;
          if (record.id !== variables.eventId) {
            return event;
          }
          found = true;
          return {
            ...record,
            start: variables.event.start,
            end: variables.event.end,
          };
        });

        if (found) {
          updatedKeys.push(queryKey as QueryKey);
          queryClient.setQueryData(queryKey, next);
        }
      }

      return { previousQueries, updatedKeys, windowKeysForNewStart };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: (_data, _error, _variables, context) => {
      const keysToInvalidate: QueryKey[] = [];
      const seen = new Set<string>();

      for (const key of [
        ...(context?.updatedKeys ?? []),
        ...(context?.windowKeysForNewStart ?? []),
      ]) {
        const id = JSON.stringify(key);
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        keysToInvalidate.push(key);
      }

      for (const key of keysToInvalidate) {
        queryClient.invalidateQueries({ queryKey: key, exact: true });
      }
    },
  });
}
