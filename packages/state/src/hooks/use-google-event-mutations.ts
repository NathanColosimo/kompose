"use client";

import type {
  CreateEventInput,
  DeleteEventInput,
} from "@kompose/api/routers/google-cal/contract";
import { sanitizeEventPayload } from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uuidv7 } from "uuidv7";
import { useStateConfig } from "../config";
import { getGoogleEventsByCalendarQueryKey } from "../google-calendar-query-keys";
import { type HeldSave, reportHeldSaveFailure } from "../held-save";

/**
 * Extended update input that includes the full Event for client-side sanitization.
 */
export interface UpdateGoogleEventInput {
  accountId: string;
  calendarId: string;
  event: Event;
  eventId: string;
  recurrenceScope?: "this" | "all" | "following";
}

export function useGoogleEventMutations() {
  const queryClient = useQueryClient();
  const { orpc, notifyError } = useStateConfig();

  const createEvent = useMutation({
    mutationFn: async ({
      failureMessage: _failureMessage,
      quiet: _quiet,
      ...variables
    }: CreateEventInput & HeldSave) => orpc.googleCal.events.create(variables),
    onMutate: async (variables) => {
      if (variables.event.recurrence?.length) {
        return { previousQueries: undefined, optimisticId: undefined };
      }

      const queryKey = getGoogleEventsByCalendarQueryKey({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
      });

      await queryClient.cancelQueries({ queryKey });

      const previousQueries = queryClient.getQueriesData<Event[]>({
        queryKey,
      });

      const optimisticId = `optimistic-${uuidv7()}`;
      const optimisticEvent: Event = {
        id: optimisticId,
        ...variables.event,
      };

      for (const [qk, data] of previousQueries) {
        if (Array.isArray(data)) {
          queryClient.setQueryData<Event[]>(qk, [...data, optimisticEvent]);
        }
      }

      return { previousQueries, optimisticId };
    },
    onSuccess: (createdEvent, _variables, context) => {
      if (!context?.optimisticId) {
        return;
      }
      if (!createdEvent) {
        return;
      }
      const queryKey = getGoogleEventsByCalendarQueryKey({
        accountId: _variables.accountId,
        calendarId: _variables.calendarId,
      });
      const queries = queryClient.getQueriesData<Event[]>({ queryKey });
      for (const [qk, data] of queries) {
        if (Array.isArray(data)) {
          queryClient.setQueryData<Event[]>(
            qk,
            data.map((e) => (e.id === context.optimisticId ? createdEvent : e))
          );
        }
      }
    },
    onError: (err, variables, context) => {
      reportHeldSaveFailure(notifyError, err, variables);
      if (context?.previousQueries) {
        for (const [qk, data] of context.previousQueries) {
          queryClient.setQueryData(qk, data);
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
    },
  });

  const updateEvent = useMutation({
    mutationFn: async (
      variables: UpdateGoogleEventInput &
        HeldSave & {
          /**
           * False to wait for the server instead of updating the cache
           * first. An editor that holds open on the save needs this: an
           * optimistic move would re-render (or unmount) it mid-save, and
           * the rollback would reset its fields.
           */
          optimistic?: boolean;
        }
    ) =>
      orpc.googleCal.events.update({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        eventId: variables.eventId,
        event: sanitizeEventPayload(variables.event),
        scope: variables.recurrenceScope ?? "this",
      }),
    onMutate: async (variables) => {
      const scope = variables.recurrenceScope ?? "this";
      const queryKey = getGoogleEventsByCalendarQueryKey({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
      });

      await queryClient.cancelQueries({
        queryKey,
      });

      const previousQueries = queryClient.getQueriesData<Event[]>({
        queryKey,
      });

      if (scope === "this" && variables.optimistic !== false) {
        for (const [cachedKey, cachedEvents] of previousQueries) {
          if (Array.isArray(cachedEvents)) {
            queryClient.setQueryData<Event[]>(
              cachedKey,
              cachedEvents.map((event) =>
                event.id === variables.eventId ? variables.event : event
              )
            );
          }
        }
      }

      return { previousQueries };
    },
    onError: (err, variables, context) => {
      reportHeldSaveFailure(notifyError, err, variables);

      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSuccess: (saved, variables) => {
      // A held save shows the server's copy as soon as it's in; other
      // scopes change more events, so the refetch below brings them.
      if (
        variables.optimistic !== false ||
        variables.recurrenceScope !== "this"
      ) {
        return;
      }
      queryClient.setQueriesData<Event[]>(
        {
          queryKey: getGoogleEventsByCalendarQueryKey({
            accountId: variables.accountId,
            calendarId: variables.calendarId,
          }),
        },
        (cached) =>
          cached?.map((event) => (event.id === saved.id ? saved : event))
      );
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
    },
  });

  const deleteEvent = useMutation({
    mutationFn: async (variables: DeleteEventInput) =>
      orpc.googleCal.events.delete(variables),
    onMutate: async (variables) => {
      const queryKey = getGoogleEventsByCalendarQueryKey({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
      });

      await queryClient.cancelQueries({
        queryKey,
      });

      const previousQueries = queryClient.getQueriesData<Event[]>({
        queryKey,
      });

      for (const [cachedKey, cachedEvents] of previousQueries) {
        if (Array.isArray(cachedEvents)) {
          queryClient.setQueryData<Event[]>(
            cachedKey,
            cachedEvents.filter((event) => event.id !== variables.eventId)
          );
        }
      }

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
    },
  });

  return { createEvent, updateEvent, deleteEvent };
}
