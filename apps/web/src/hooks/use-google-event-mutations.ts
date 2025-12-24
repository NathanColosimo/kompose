"use client";

import type { DeleteEventInput } from "@kompose/api/routers/google-cal/contract";
import type { CreateEvent, Event } from "@kompose/google-cal/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

/**
 * Extended update input that includes the full Event for client-side sanitization.
 * The contract's UpdateEventInput expects CreateEvent, but we accept Event here
 * and sanitize it before sending.
 */
export interface UpdateGoogleEventInput {
  accountId: string;
  calendarId: string;
  eventId: string;
  event: Event;
  recurrenceScope?: "this" | "all" | "following";
}

/**
 * Minimal sanitization to fit CreateEvent input (server handles recurrence logic).
 */
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
 * Google event mutations for update and delete operations.
 */
export function useGoogleEventMutations() {
  const queryClient = useQueryClient();

  const updateEvent = useMutation({
    mutationFn: async (variables: UpdateGoogleEventInput) =>
      orpc.googleCal.events.update.call({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        eventId: variables.eventId,
        event: sanitizeEventPayload(variables.event),
        scope: variables.recurrenceScope ?? "this",
      }),
    onMutate: async (variables) => {
      const scope = variables.recurrenceScope ?? "this";

      await queryClient.cancelQueries({
        queryKey: orpc.googleCal.events.key(),
      });

      // Store previous state for rollback
      const previousQueries = queryClient.getQueriesData<Event[]>({
        queryKey: orpc.googleCal.events.key(),
      });

      // Only apply optimistic update for "this" scope (single instance)
      // "all" and "following" scopes are too complex (affect multiple events)
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
      toast.error(err.message);

      // Rollback on error
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

  const deleteEvent = useMutation({
    mutationFn: async (variables: DeleteEventInput) =>
      orpc.googleCal.events.delete.call({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        eventId: variables.eventId,
        scope: variables.scope,
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: orpc.googleCal.events.key(),
      });

      // Store previous state for rollback
      const previousQueries = queryClient.getQueriesData<Event[]>({
        queryKey: orpc.googleCal.events.key(),
      });

      // Optimistically remove the event from all cached queries
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
      toast.error(err.message);

      // Rollback on error
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

  return { updateEvent, deleteEvent };
}
