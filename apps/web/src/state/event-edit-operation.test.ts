import { expect, test } from "bun:test";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import {
  type EventEditOperationAction,
  runEventEditOperation,
} from "@kompose/state/event-edit-operation";
import { getGoogleEventsByCalendarQueryKey } from "@kompose/state/google-calendar-query-keys";
import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { eventEditOperationAtom } from "./event-edit-operation";

const source = {
  accountId: "account",
  calendarId: "calendar",
  eventId: "event",
};
const event: GoogleEvent = {
  id: source.eventId,
  start: { dateTime: "2026-11-06T10:00:00Z" },
  end: { dateTime: "2026-11-06T11:00:00Z" },
};
const queryKey = getGoogleEventsByCalendarQueryKey(source);
const unexpected = () => Promise.reject(new Error("Unexpected mutation"));

function setup() {
  const store = createStore();
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKey, [event]);
  const dispatch = (action: EventEditOperationAction) =>
    store.set(eventEditOperationAtom, action);
  const runningOperations = new Set<number>();
  const run = (mutations: Parameters<typeof runEventEditOperation>[1]) => {
    const operation = store.get(eventEditOperationAtom);
    if (operation.kind !== "running") {
      throw new Error(`Expected running, got ${operation.kind}`);
    }
    return runEventEditOperation(
      operation,
      mutations,
      dispatch,
      runningOperations
    );
  };
  return { store, queryClient, dispatch, run };
}

test("a time edit keeps the move-only retry after the event block remounts with a new key", async () => {
  const { store, queryClient, dispatch, run } = setup();
  const unmountOriginal = store.sub(eventEditOperationAtom, () => undefined);
  const updated = { ...event, start: { dateTime: "2026-11-07T11:00:00Z" } };
  dispatch({
    type: "prepare",
    id: 1,
    confirm: false,
    scope: "this",
    command: {
      kind: "save",
      isRecurring: false,
      update: { ...source, event: updated },
      move: { ...source, destinationCalendarId: "destination" },
    },
  });
  const updateResponse = Promise.withResolvers<GoogleEvent>();
  const calls: string[] = [];
  const pending = run({
    delete: unexpected,
    update: () => {
      calls.push("update");
      queryClient.setQueryData(queryKey, [updated]);
      return updateResponse.promise;
    },
    move: () => {
      calls.push("move");
      return Promise.reject(new Error("move failed"));
    },
  });
  expect(queryClient.getQueryData(queryKey)).toEqual([updated]);
  unmountOriginal();
  // The replacement event block observes the same calendar-owned operation.
  const unmountReplacement = store.sub(eventEditOperationAtom, () => undefined);
  updateResponse.resolve(updated);
  await pending;
  expect(store.get(eventEditOperationAtom)).toMatchObject({
    kind: "failed",
    retryStep: "move",
  });
  dispatch({ type: "run", id: 1 });
  await run({
    delete: unexpected,
    update: unexpected,
    move: () => {
      calls.push("move");
      return Promise.resolve(null);
    },
  });
  expect(calls).toEqual(["update", "move", "move"]);
  expect(store.get(eventEditOperationAtom)).toEqual({ kind: "idle" });
  unmountReplacement();
  queryClient.clear();
});

test("an optimistically removed event retains its delete command without any event block mounted", async () => {
  const { store, queryClient, dispatch, run } = setup();
  const unmountEvent = store.sub(eventEditOperationAtom, () => undefined);
  dispatch({
    type: "prepare",
    id: 1,
    confirm: true,
    scope: "this",
    command: { kind: "delete", isRecurring: false, variables: source },
  });
  dispatch({ type: "run", id: 1 });
  const response = Promise.withResolvers<null>();
  const pending = run({
    update: unexpected,
    move: unexpected,
    delete: () => {
      queryClient.setQueryData(queryKey, []);
      return response.promise;
    },
  });
  expect(queryClient.getQueryData(queryKey)).toEqual([]);
  unmountEvent();
  response.reject(new Error("delete failed"));
  await pending;
  expect(store.get(eventEditOperationAtom)).toMatchObject({
    kind: "failed",
    retryStep: "delete",
  });
  dispatch({ type: "run", id: 1 });
  const deletedIds: string[] = [];
  await run({
    update: unexpected,
    move: unexpected,
    delete: (variables) => {
      deletedIds.push(variables.eventId);
      return Promise.resolve(null);
    },
  });
  expect(deletedIds).toEqual(["event"]);
  expect(store.get(eventEditOperationAtom)).toEqual({ kind: "idle" });
  queryClient.clear();
});
