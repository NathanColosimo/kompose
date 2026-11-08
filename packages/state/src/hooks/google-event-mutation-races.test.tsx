import { afterEach, expect, mock, test } from "bun:test";
import type { AppRouterClient } from "@kompose/api/routers/index";
import type { Event } from "@kompose/google-cal/schema";
import { createORPCClient } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { renderToString } from "react-dom/server";
import { stateConfigAtom } from "../config";
import { getGoogleEventsQueryKey } from "../google-calendar-query-keys";
import { useGoogleEventMutations } from "./use-google-event-mutations";
import { useMoveGoogleEventMutation } from "./use-move-google-event-mutation";

const calendar = { accountId: "account", calendarId: "source" };
const window = {
  timeMin: "2026-11-01T00:00:00Z",
  timeMax: "2026-12-01T00:00:00Z",
};
const sourceKey = getGoogleEventsQueryKey(calendar, window);
const destinationKey = getGoogleEventsQueryKey(
  { ...calendar, calendarId: "destination" },
  window
);
const originalEvent: Event = {
  id: "event",
  summary: "Original title",
  start: { dateTime: "2026-11-06T10:00:00Z" },
  end: { dateTime: "2026-11-06T11:00:00Z" },
};
const editedEvent: Event = { ...originalEvent, summary: "Successful edit" };
const queryClients: QueryClient[] = [];

afterEach(() => {
  for (const queryClient of queryClients.splice(0)) {
    queryClient.clear();
  }
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClients.push(queryClient);
  queryClient.setQueryData(sourceKey, [originalEvent]);
  queryClient.setQueryData(destinationKey, [originalEvent]);

  const requestStarted = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Event>();
  const call = mock(async () => editedEvent).mockImplementationOnce(
    async () => {
      requestStarted.resolve();
      return await response.promise;
    }
  );
  const notifyError = mock();
  const store = createStore();
  store.set(stateConfigAtom, {
    authClient: {
      accountInfo: async () => null,
      listAccounts: async () => [],
      unlinkAccount: async () => undefined,
    },
    orpc: createORPCClient<AppRouterClient>({ call }),
    notifyError,
  });

  let mutations:
    | {
        move: ReturnType<typeof useMoveGoogleEventMutation>;
        events: ReturnType<typeof useGoogleEventMutations>;
      }
    | undefined;
  function MutationHarness() {
    mutations = {
      move: useMoveGoogleEventMutation(),
      events: useGoogleEventMutations(),
    };
    return null;
  }
  renderToString(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <MutationHarness />
      </QueryClientProvider>
    </Provider>
  );
  if (!mutations) {
    throw new Error("Mutation hooks did not render");
  }

  return {
    ...mutations,
    queryClient,
    notifyError,
    requestStarted: requestStarted.promise,
    response,
  };
}

function startCalendarReads(queryClient: QueryClient) {
  const response = Promise.withResolvers<Event[]>();
  const results = Promise.allSettled(
    [sourceKey, destinationKey].map((queryKey) =>
      queryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal }) => {
          signal.throwIfAborted();
          return response.promise;
        },
      })
    )
  );

  return async () => {
    response.resolve([originalEvent]);
    expect(await results).toEqual([
      { status: "fulfilled", value: [originalEvent] },
      { status: "fulfilled", value: [originalEvent] },
    ]);
  };
}

test("a failed move preserves successful edits in both calendars", async () => {
  const { move, events, queryClient, notifyError, requestStarted, response } =
    setup();
  const finishCalendarReads = startCalendarReads(queryClient);
  const moving = move.mutateAsync({
    ...calendar,
    destinationCalendarId: "destination",
    eventId: originalEvent.id,
    scope: "this",
  });
  await requestStarted;
  await finishCalendarReads();

  await events.updateEvent.mutateAsync({
    ...calendar,
    eventId: originalEvent.id,
    event: editedEvent,
  });
  await events.updateEvent.mutateAsync({
    ...calendar,
    calendarId: "destination",
    eventId: originalEvent.id,
    event: editedEvent,
  });

  const error = new Error("Move failed");
  response.reject(error);
  await expect(moving).rejects.toThrow("Move failed");
  expect(queryClient.getQueryData(sourceKey)).toEqual([editedEvent]);
  expect(queryClient.getQueryData(destinationKey)).toEqual([editedEvent]);
  expect(notifyError).toHaveBeenCalledWith(error);
  expect(queryClient.getQueryState(sourceKey)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(destinationKey)?.isInvalidated).toBe(true);
});

test.each(["all", "following"] as const)(
  "a failed %s update preserves a successful event edit",
  async (recurrenceScope) => {
    const { events, queryClient, notifyError, requestStarted, response } =
      setup();
    const finishCalendarReads = startCalendarReads(queryClient);
    const updating = events.updateEvent.mutateAsync({
      ...calendar,
      eventId: originalEvent.id,
      event: { ...originalEvent, summary: "Series edit" },
      recurrenceScope,
    });
    await requestStarted;
    await finishCalendarReads();
    expect(queryClient.getQueryData(sourceKey)).toEqual([originalEvent]);

    await events.updateEvent.mutateAsync({
      ...calendar,
      eventId: originalEvent.id,
      event: editedEvent,
    });

    const error = new Error("Series update failed");
    response.reject(error);
    await expect(updating).rejects.toThrow("Series update failed");
    expect(queryClient.getQueryData(sourceKey)).toEqual([editedEvent]);
    expect(notifyError).toHaveBeenCalledWith(error);
    expect(queryClient.getQueryState(sourceKey)?.isInvalidated).toBe(true);
  }
);

test.each(["default", "this"] as const)(
  "a %s occurrence update is optimistic and rolls back on failure",
  async (scope) => {
    const { events, queryClient, notifyError, requestStarted, response } =
      setup();
    const updating = events.updateEvent.mutateAsync({
      ...calendar,
      eventId: originalEvent.id,
      event: editedEvent,
      recurrenceScope: scope === "default" ? undefined : scope,
    });
    await requestStarted;
    expect(queryClient.getQueryData(sourceKey)).toEqual([editedEvent]);
    expect(queryClient.getQueryData(destinationKey)).toEqual([originalEvent]);

    const error = new Error("Occurrence update failed");
    response.reject(error);
    await expect(updating).rejects.toThrow("Occurrence update failed");
    expect(queryClient.getQueryData(sourceKey)).toEqual([originalEvent]);
    expect(notifyError).toHaveBeenCalledWith(error);
    expect(queryClient.getQueryState(sourceKey)?.isInvalidated).toBe(true);
  }
);
