"use client";

import type {
  CreateEventInput,
  DeleteEventInput,
} from "@kompose/api/routers/google-cal/contract";
import { sanitizeEventPayload } from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import {
  type QueryClient,
  replaceEqualDeep,
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

/** Each cached list of a calendar's events that has the event, with its copy. */
interface CachedCopy {
  event: Event;
  key: readonly unknown[];
}

/**
 * The event's copy in each of its calendar's cached lists that has it: an
 * event over a month's end is in two, maybe fetched at different times.
 */
function cachedCopies(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  eventId: string
): CachedCopy[] {
  return queryClient
    .getQueriesData<Event[]>({ queryKey })
    .flatMap(([key, events]) => {
      const event = Array.isArray(events)
        ? events.find((cached) => cached.id === eventId)
        : undefined;
      return event ? [{ event, key }] : [];
    });
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
      if (!optimisticId) {
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

/** The scope an update saves with: one occurrence unless it says. */
function scopeOf(variables: UpdateGoogleEventVariables) {
  return variables.recurrenceScope ?? "this";
}

/** Whether an update changes the cached event before the server answers. */
function updatesAtOnce(variables: UpdateGoogleEventVariables): boolean {
  return scopeOf(variables) === "this" && variables.optimistic !== false;
}

/**
 * An update: for one occurrence, unless the editor holds the save
 * (`optimistic: false`), the event changes in the cached lists at once,
 * and on failure each list's old copy comes back where the edit still
 * shows. A failure is reported unless the editor says it (`quiet`).
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
        scope: scopeOf(variables),
      }),
    onMutate: async (variables: UpdateGoogleEventVariables) => {
      // Only one occurrence, saved without holding, changes the cache
      // first; anything else has nothing to put back on failure (putting a
      // snapshot back would undo what a refetch brought meanwhile).
      if (!updatesAtOnce(variables)) {
        return { previous: [] };
      }
      const queryKey = getGoogleEventsByCalendarQueryKey(variables);
      await queryClient.cancelQueries({ queryKey });

      const previous = cachedCopies(queryClient, queryKey, variables.eventId);
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
      context: { previous: CachedCopy[] } | undefined
    ) => {
      reportHeldSaveFailure(notifyError, err, variables);
      // Each list gets its own old copy back, and only where the edit
      // still shows: a newer copy a refetch brought stays
      // (`replaceEqualDeep` keeps the cached copy when it's equal).
      for (const { event: old, key } of context?.previous ?? []) {
        queryClient.setQueryData<Event[]>(key, (events) =>
          events?.map((event) =>
            event.id === variables.eventId &&
            replaceEqualDeep(event, variables.event) === event
              ? old
              : event
          )
        );
      }
    },
    onSuccess: (saved: Event, variables: UpdateGoogleEventVariables) => {
      // A held save shows the server's copy as soon as it's in; other
      // scopes change more events, so the refetch below brings them.
      if (variables.optimistic !== false || scopeOf(variables) !== "this") {
        return;
      }
      editCachedEvents(queryClient, variables, (events) =>
        events.map((event) => (event.id === saved.id ? saved : event))
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
 * A delete: the event leaves the cached lists at once and, on failure,
 * comes back to those it left (only it: what a refetch brought meanwhile
 * stays). A failure is reported unless the dialog holding it says it
 * (`quiet`), as for a held save.
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

      // The lists it leaves, each with its copy, to put back on failure.
      const removedFrom = cachedCopies(
        queryClient,
        queryKey,
        variables.eventId
      );
      editCachedEvents(queryClient, variables, (events) =>
        events.filter((event) => event.id !== variables.eventId)
      );

      return { removedFrom };
    },
    onError: (
      err: Error,
      variables: DeleteEventInput & HeldSave,
      context: { removedFrom: CachedCopy[] } | undefined
    ) => {
      reportHeldSaveFailure(notifyError, err, variables);
      // Back in each list it left, unless a refetch already brought it;
      // the refetch after then orders it.
      for (const { event: removed, key } of context?.removedFrom ?? []) {
        queryClient.setQueryData<Event[]>(key, (events) =>
          Array.isArray(events) &&
          !events.some((event) => event.id === removed.id)
            ? [...events, removed]
            : events
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
