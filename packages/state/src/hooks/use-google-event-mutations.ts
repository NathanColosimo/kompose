"use client";

import type { DeleteEventInput } from "@kompose/api/routers/google-cal/contract";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useStateConfig } from "../config";
import { getGoogleEventsByCalendarQueryKey } from "../google-calendar-query-keys";

/**
 * Input for creating a new Google Calendar event.
 */
export interface CreateGoogleEventInput {
  accountId: string;
  calendarId: string;
  event: CreateEvent;
}

/**
 * Extended update input that includes the full Event for client-side sanitization.
 */
export interface UpdateGoogleEventInput {
  accountId: string;
  calendarId: string;
  eventId: string;
  event: Event;
  recurrenceScope?: "this" | "all" | "following";
}

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
 * Google event mutations for create, update, and delete operations.
 */
export function useGoogleEventMutations() {
  const queryClient = useQueryClient();
  const { orpc, notifyError } = useStateConfig();

  const createEvent = useMutation({
    mutationFn: async (variables: CreateGoogleEventInput) =>
      orpc.googleCal.events.create({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        event: variables.event,
      }),
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
    },
  });

  const updateEvent = useMutation({
    mutationFn: async (variables: UpdateGoogleEventInput) =>
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

      if (scope === "this") {
        for (const [queryKey, data] of previousQueries) {
          if (Array.isArray(data)) {
            queryClient.setQueryData<Event[]>(
              queryKey,
              data.map((event) =>
                event.id === variables.eventId ? variables.event : event
              )
            );
          }
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

  const deleteEvent = useMutation({
    mutationFn: async (variables: DeleteEventInput) =>
      orpc.googleCal.events.delete({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        eventId: variables.eventId,
        scope: variables.scope,
      }),
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

      for (const [queryKey, data] of previousQueries) {
        if (Array.isArray(data)) {
          queryClient.setQueryData<Event[]>(
            queryKey,
            data.filter((event) => event.id !== variables.eventId)
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
