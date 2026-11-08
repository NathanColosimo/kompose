"use client";

import type {
  CreateEventInput,
  DeleteEventInput,
} from "@kompose/api/routers/google-cal/contract";
import { sanitizeEventPayload } from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { uuidv7 } from "uuidv7";
import { type StateConfig, useStateConfig } from "../config";
import {
  getGoogleEventsByCalendarQueryKey,
  invalidateGoogleEventQueries,
} from "../google-calendar-query-keys";
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

/** An update's variables, with how an editor holds the save. */
export type UpdateGoogleEventVariables = UpdateGoogleEventInput &
  HeldSave & {
    /**
     * False to wait for the server instead of updating the cache first. An
     * editor that holds open on the save needs this: an optimistic move
     * would re-render (or unmount) it mid-save, and the rollback would
     * reset its fields.
     */
    optimistic?: boolean;
  };

export function useGoogleEventMutations() {
  const queryClient = useQueryClient();
  const { orpc, notifyError } = useStateConfig();

  const createEvent = useMutation(
    createGoogleEventMutationOptions(queryClient, { notifyError, orpc })
  );

  const updateEvent = useMutation(
    updateGoogleEventMutationOptions(queryClient, { notifyError, orpc })
  );

  const deleteEvent = useMutation(
    deleteGoogleEventMutationOptions(queryClient, { notifyError, orpc })
  );

  return { createEvent, updateEvent, deleteEvent };
}

/**
 * Each cached list of a calendar's events, through `edit`. A rollback edits
 * only its own event, so what a refetch brought meanwhile stays.
 */
function editCachedEvents(
  queryClient: QueryClient,
  calendar: { accountId: string; calendarId: string },
  edit: (events: Event[]) => Event[]
): void {
  queryClient.setQueriesData<Event[]>(
    { queryKey: getGoogleEventsByCalendarQueryKey(calendar) },
    (cached) => (Array.isArray(cached) ? edit(cached) : cached)
  );
}

/** The cached copy of an event, from any of its calendar's lists. */
function cachedEvent(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  eventId: string
): Event | undefined {
  for (const [, events] of queryClient.getQueriesData<Event[]>({ queryKey })) {
    const found = Array.isArray(events)
      ? events.find((event) => event.id === eventId)
      : undefined;
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** What a create's optimistic write left to undo: its stand-in's id. */
interface CreateContext {
  optimisticId: string | undefined;
}

/**
 * A create: a one-off event shows in the cached lists at once, under a
 * stand-in id the server's copy replaces. A failure is reported unless the
 * editor says it (`quiet`).
 */
export function createGoogleEventMutationOptions(
  queryClient: QueryClient,
  { notifyError, orpc }: Pick<StateConfig, "notifyError" | "orpc">
) {
  return {
    mutationFn: async ({
      failureMessage: _failureMessage,
      quiet: _quiet,
      ...variables
    }: CreateEventInput & HeldSave) => orpc.googleCal.events.create(variables),
    onMutate: async (variables: CreateEventInput & HeldSave) => {
      if (variables.event.recurrence?.length) {
        return { optimisticId: undefined };
      }

      await queryClient.cancelQueries({
        queryKey: getGoogleEventsByCalendarQueryKey(variables),
      });

      const optimisticId = `optimistic-${uuidv7()}`;
      const optimisticEvent: Event = {
        id: optimisticId,
        ...variables.event,
      };
      editCachedEvents(queryClient, variables, (events) => [
        ...events,
        optimisticEvent,
      ]);

      return { optimisticId };
    },
    onSuccess: (
      createdEvent: Event,
      variables: CreateEventInput & HeldSave,
      context: CreateContext | undefined
    ) => {
      const optimisticId = context?.optimisticId;
      if (!(optimisticId && createdEvent)) {
        return;
      }
      editCachedEvents(queryClient, variables, (events) =>
        events.map((event) =>
          event.id === optimisticId ? createdEvent : event
        )
      );
    },
    onError: (
      err: Error,
      variables: CreateEventInput & HeldSave,
      context: CreateContext | undefined
    ) => {
      reportHeldSaveFailure(notifyError, err, variables);
      const optimisticId = context?.optimisticId;
      if (optimisticId) {
        editCachedEvents(queryClient, variables, (events) =>
          events.filter((event) => event.id !== optimisticId)
        );
      }
    },
    onSettled: (
      _data: unknown,
      _error: Error | null,
      variables: CreateEventInput & HeldSave
    ) => {
      invalidateGoogleEventQueries(queryClient, [
        { accountId: variables.accountId, calendarId: variables.calendarId },
      ]);
    },
  };
}

/** Whether an update changes the cached event before the server answers. */
function updatesAtOnce(variables: UpdateGoogleEventVariables): boolean {
  return (
    (variables.recurrenceScope ?? "this") === "this" &&
    variables.optimistic !== false
  );
}

/**
 * An update: for one occurrence, unless the editor holds the save
 * (`optimistic: false`), the event changes in the cached lists at once and
 * its old copy comes back on failure (only it). A failure is reported unless the editor says it
 * (`quiet`).
 */
export function updateGoogleEventMutationOptions(
  queryClient: QueryClient,
  { notifyError, orpc }: Pick<StateConfig, "notifyError" | "orpc">
) {
  return {
    mutationFn: async (variables: UpdateGoogleEventVariables) =>
      orpc.googleCal.events.update({
        accountId: variables.accountId,
        calendarId: variables.calendarId,
        eventId: variables.eventId,
        event: sanitizeEventPayload(variables.event),
        scope: variables.recurrenceScope ?? "this",
      }),
    onMutate: async (variables: UpdateGoogleEventVariables) => {
      // Only one occurrence, saved without holding, changes the cache
      // first; anything else has nothing to put back on failure (putting a
      // snapshot back would undo what a refetch brought meanwhile).
      if (!updatesAtOnce(variables)) {
        return { previous: undefined };
      }
      const queryKey = getGoogleEventsByCalendarQueryKey(variables);
      await queryClient.cancelQueries({ queryKey });

      const previous = cachedEvent(queryClient, queryKey, variables.eventId);
      editCachedEvents(queryClient, variables, (events) =>
        events.map((event) =>
          event.id === variables.eventId ? variables.event : event
        )
      );

      return { previous };
    },
    onError: (
      err: Error,
      variables: UpdateGoogleEventVariables,
      context: { previous: Event | undefined } | undefined
    ) => {
      reportHeldSaveFailure(notifyError, err, variables);
      const previous = context?.previous;
      if (previous) {
        editCachedEvents(queryClient, variables, (events) =>
          events.map((event) =>
            event.id === variables.eventId ? previous : event
          )
        );
      }
    },
    onSuccess: (saved: Event, variables: UpdateGoogleEventVariables) => {
      // A held save shows the server's copy as soon as it's in; other
      // scopes change more events, so the refetch below brings them.
      if (
        variables.optimistic !== false ||
        (variables.recurrenceScope ?? "this") !== "this"
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
    onSettled: (
      _data: unknown,
      _error: Error | null,
      variables: UpdateGoogleEventVariables
    ) => {
      invalidateGoogleEventQueries(queryClient, [
        { accountId: variables.accountId, calendarId: variables.calendarId },
      ]);
    },
  };
}

/**
 * A delete: the event leaves the cached lists at once and comes back on
 * failure (only it: what a refetch brought meanwhile stays), which is
 * reported unless the dialog holding it says it (`quiet`), as for a held
 * save.
 */
export function deleteGoogleEventMutationOptions(
  queryClient: QueryClient,
  { notifyError, orpc }: Pick<StateConfig, "notifyError" | "orpc">
) {
  return {
    mutationFn: async ({
      failureMessage: _failureMessage,
      quiet: _quiet,
      ...variables
    }: DeleteEventInput & HeldSave) => orpc.googleCal.events.delete(variables),
    onMutate: async (variables: DeleteEventInput & HeldSave) => {
      const queryKey = getGoogleEventsByCalendarQueryKey(variables);
      await queryClient.cancelQueries({ queryKey });

      const removed = cachedEvent(queryClient, queryKey, variables.eventId);
      editCachedEvents(queryClient, variables, (events) =>
        events.filter((event) => event.id !== variables.eventId)
      );

      return { removed };
    },
    onError: (
      err: Error,
      variables: DeleteEventInput & HeldSave,
      context: { removed: Event | undefined } | undefined
    ) => {
      reportHeldSaveFailure(notifyError, err, variables);
      const removed = context?.removed;
      if (removed) {
        // Back in each list it's missing from; the refetch then orders it.
        editCachedEvents(queryClient, variables, (events) =>
          events.some((event) => event.id === removed.id)
            ? events
            : [...events, removed]
        );
      }
    },
    onSettled: (
      _data: unknown,
      _error: Error | null,
      variables: DeleteEventInput & HeldSave
    ) => {
      invalidateGoogleEventQueries(queryClient, [
        { accountId: variables.accountId, calendarId: variables.calendarId },
      ]);
    },
  };
}
