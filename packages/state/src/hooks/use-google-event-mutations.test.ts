import { expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { StateConfig } from "../config";
import { getGoogleEventsByCalendarQueryKey } from "../google-calendar-query-keys";
import {
  createGoogleEventMutationOptions,
  deleteGoogleEventMutationOptions,
  updateGoogleEventMutationOptions,
} from "./use-google-event-mutations";

const removal = {
  accountId: "acct",
  calendarId: "work",
  eventId: "event",
  scope: "following" as const,
};

/** A delete the server refuses, and what the app and cache were left with. */
async function failedDelete(held: {
  failureMessage?: string;
  quiet?: boolean;
}) {
  const told: Error[] = [];
  const sent: unknown[] = [];
  const whileSent: unknown[] = [];
  const queryClient = new QueryClient();
  const queryKey = [
    ...getGoogleEventsByCalendarQueryKey({
      accountId: "acct",
      calendarId: "work",
    }),
    "2026-11",
  ];
  const cached = [{ id: "event" }, { id: "other" }];
  queryClient.setQueryData(queryKey, cached);
  const orpc = {
    googleCal: {
      events: {
        delete: (input: unknown) => {
          sent.push(input);
          whileSent.push(queryClient.getQueryData(queryKey));
          // The realtime sync brings another event meanwhile.
          queryClient.setQueryData(queryKey, [{ id: "other" }, { id: "new" }]);
          return Promise.reject(new Error("refused"));
        },
      },
    },
    // Only the call a delete makes: the client's type has every route.
  } as unknown as StateConfig["orpc"];
  const observer = new MutationObserver(
    queryClient,
    deleteGoogleEventMutationOptions(queryClient, {
      notifyError: (error) => told.push(error),
      orpc,
    })
  );
  await observer.mutate({ ...removal, ...held }).catch(() => undefined);
  return { cached: queryClient.getQueryData(queryKey), sent, told, whileSent };
}

test("a failed delete the dialog reports itself shows no toast", async () => {
  const { told } = await failedDelete({ quiet: true });
  expect(told).toEqual([]);
});

test("a failed delete otherwise says what failed, in the dialog's words", async () => {
  const { told } = await failedDelete({
    failureMessage: "Couldn't delete it.",
  });
  expect(told.map((error) => error.message)).toEqual(["Couldn't delete it."]);
  expect(told[0]?.cause).toEqual(new Error("refused"));
});

test("the event leaves the list at once, and comes back on failure", async () => {
  const { cached, sent, whileSent } = await failedDelete({ quiet: true });
  expect(sent).toEqual([removal]);
  expect(whileSent).toEqual([[{ id: "other" }]]);
  // Only the deleted event comes back: what the refetch brought stays.
  expect(cached).toEqual([{ id: "other" }, { id: "new" }, { id: "event" }]);
});

/**
 * A held update (`optimistic: false`) the server answers with `answer`,
 * and the calendar's list after it, which the realtime sync refreshed
 * while the save was out.
 */
async function heldUpdate(
  answer: () => Promise<unknown>,
  recurrenceScope?: "all" | "this"
) {
  const queryClient = new QueryClient();
  const queryKey = [
    ...getGoogleEventsByCalendarQueryKey({
      accountId: "acct",
      calendarId: "work",
    }),
    "2026-11",
  ];
  const event = {
    end: { dateTime: "2026-11-09T09:30:00-05:00" },
    id: "event",
    start: { dateTime: "2026-11-09T09:00:00-05:00" },
    summary: "Standup",
  };
  queryClient.setQueryData(queryKey, [event]);
  const orpc = {
    googleCal: {
      events: {
        update: () => {
          queryClient.setQueryData(queryKey, [event, { id: "new" }]);
          return answer();
        },
      },
    },
    // Only the call an update makes: the client's type has every route.
  } as unknown as StateConfig["orpc"];
  const observer = new MutationObserver(
    queryClient,
    updateGoogleEventMutationOptions(queryClient, {
      notifyError: () => undefined,
      orpc,
    })
  );
  await observer
    .mutate({
      accountId: "acct",
      calendarId: "work",
      event: { ...event, summary: "Planning" },
      eventId: "event",
      optimistic: false,
      quiet: true,
      recurrenceScope,
    })
    .catch(() => undefined);
  return queryClient.getQueryData(queryKey);
}

test("a failed held update leaves the list as it's since been refreshed", async () => {
  // It changed nothing before the server answered, so nothing goes back.
  const refused = () => Promise.reject(new Error("refused"));
  const lists = await Promise.all(
    (["all", "this"] as const).map((scope) => heldUpdate(refused, scope))
  );
  for (const cached of lists) {
    expect(cached).toEqual([
      expect.objectContaining({ summary: "Standup" }),
      { id: "new" },
    ]);
  }
});

test("a held update of one occurrence shows the server's copy once it's in", async () => {
  // With no scope given, the save is for this occurrence.
  const cached = await heldUpdate(() =>
    Promise.resolve({ id: "event", summary: "Planning (saved)" })
  );
  expect(cached).toEqual([
    { id: "event", summary: "Planning (saved)" },
    { id: "new" },
  ]);
});

test("a failed optimistic update puts back only that event", async () => {
  const queryClient = new QueryClient();
  const queryKey = [
    ...getGoogleEventsByCalendarQueryKey({
      accountId: "acct",
      calendarId: "work",
    }),
    "2026-11",
  ];
  const event = {
    end: { dateTime: "2026-11-09T09:30:00-05:00" },
    id: "event",
    start: { dateTime: "2026-11-09T09:00:00-05:00" },
    summary: "Standup",
  };
  queryClient.setQueryData(queryKey, [event]);
  const whileSent: unknown[] = [];
  const orpc = {
    googleCal: {
      events: {
        update: () => {
          whileSent.push(queryClient.getQueryData(queryKey));
          queryClient.setQueryData(queryKey, [
            ...(queryClient.getQueryData<unknown[]>(queryKey) ?? []),
            { id: "new" },
          ]);
          return Promise.reject(new Error("refused"));
        },
      },
    },
  } as unknown as StateConfig["orpc"];
  const observer = new MutationObserver(
    queryClient,
    updateGoogleEventMutationOptions(queryClient, {
      notifyError: () => undefined,
      orpc,
    })
  );
  await observer
    .mutate({
      accountId: "acct",
      calendarId: "work",
      event: { ...event, summary: "Planning" },
      eventId: "event",
    })
    .catch(() => undefined);
  expect(whileSent).toEqual([[{ ...event, summary: "Planning" }]]);
  expect(queryClient.getQueryData(queryKey)).toEqual([event, { id: "new" }]);
});

test("a failed create takes back only the event it added", async () => {
  const queryClient = new QueryClient();
  const queryKey = [
    ...getGoogleEventsByCalendarQueryKey({
      accountId: "acct",
      calendarId: "work",
    }),
    "2026-11",
  ];
  queryClient.setQueryData(queryKey, [{ id: "other" }]);
  const whileSent: unknown[] = [];
  const orpc = {
    googleCal: {
      events: {
        create: () => {
          whileSent.push(queryClient.getQueryData<unknown[]>(queryKey)?.length);
          queryClient.setQueryData(queryKey, [
            ...(queryClient.getQueryData<unknown[]>(queryKey) ?? []),
            { id: "new" },
          ]);
          return Promise.reject(new Error("refused"));
        },
      },
    },
  } as unknown as StateConfig["orpc"];
  const observer = new MutationObserver(
    queryClient,
    createGoogleEventMutationOptions(queryClient, {
      notifyError: () => undefined,
      orpc,
    })
  );
  await observer
    .mutate({
      accountId: "acct",
      calendarId: "work",
      event: {
        end: { dateTime: "2026-11-09T09:30:00-05:00" },
        start: { dateTime: "2026-11-09T09:00:00-05:00" },
        summary: "Lunch",
      },
    } as never)
    .catch(() => undefined);
  expect(whileSent).toEqual([2]);
  expect(queryClient.getQueryData(queryKey)).toEqual([
    { id: "other" },
    { id: "new" },
  ]);
});
