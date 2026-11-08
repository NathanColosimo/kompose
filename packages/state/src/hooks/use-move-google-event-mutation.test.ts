import { expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { StateConfig } from "../config";
import {
  getGoogleEventMastersByCalendarQueryKey,
  getGoogleEventsByCalendarQueryKey,
} from "../google-calendar-query-keys";
import { moveGoogleEventMutationOptions } from "./use-move-google-event-mutation";

const move = {
  accountId: "acct",
  calendarId: "work",
  destinationCalendarId: "home",
  eventId: "event",
  scope: "all" as const,
};

/**
 * A move the server refuses, the errors the app was told about, and the
 * source calendar's list after it, which the realtime sync refreshed while
 * the move was out.
 */
async function failedMove(held: { failureMessage?: string; quiet?: boolean }) {
  const told: Error[] = [];
  const sent: unknown[] = [];
  const queryClient = new QueryClient();
  const queryKey = [
    ...getGoogleEventsByCalendarQueryKey({
      accountId: "acct",
      calendarId: "work",
    }),
    "2026-11",
  ];
  queryClient.setQueryData(queryKey, [{ id: "event" }]);
  const orpc = {
    googleCal: {
      events: {
        move: (input: unknown) => {
          sent.push(input);
          queryClient.setQueryData(queryKey, [{ id: "event" }, { id: "new" }]);
          return Promise.reject(new Error("refused"));
        },
      },
    },
    // Only the call a move makes: the client's type has every route.
  } as unknown as StateConfig["orpc"];
  const observer = new MutationObserver(
    queryClient,
    moveGoogleEventMutationOptions(queryClient, {
      notifyError: (error) => told.push(error),
      orpc,
    })
  );
  await observer.mutate({ ...move, ...held }).catch(() => undefined);
  return { cached: queryClient.getQueryData(queryKey), sent, told };
}

test("a failed move the editor reports itself shows no toast", async () => {
  const { told } = await failedMove({ quiet: true });
  expect(told).toEqual([]);
});

test("a failed move otherwise says what failed, in the editor's words", async () => {
  const { told } = await failedMove({ failureMessage: "Couldn't move it." });
  expect(told.map((error) => error.message)).toEqual(["Couldn't move it."]);
  expect(told[0]?.cause).toEqual(new Error("refused"));
});

test("the server gets the move alone, not the editor's options", async () => {
  const { sent } = await failedMove({ failureMessage: "x", quiet: true });
  expect(sent).toEqual([move]);
});

test("a failed move leaves the lists as they've since been refreshed", async () => {
  // Nothing changed them before the move, so nothing is put back.
  const { cached } = await failedMove({ quiet: true });
  expect(cached).toEqual([{ id: "event" }, { id: "new" }]);
});

test("a move marks both calendars' events and series stale, moved or refused", async () => {
  const keys = ["work", "home"].flatMap((calendarId) => [
    [
      ...getGoogleEventsByCalendarQueryKey({ accountId: "acct", calendarId }),
      "2026-11",
    ],
    [
      ...getGoogleEventMastersByCalendarQueryKey({
        accountId: "acct",
        calendarId,
      }),
      "series",
    ],
  ]);
  const answers = [
    () => Promise.resolve(null),
    () => Promise.reject(new Error("refused")),
  ];
  const runs = answers.map(async (answer) => {
    const queryClient = new QueryClient();
    for (const key of keys) {
      queryClient.setQueryData(key, []);
    }
    // Only the call a move makes: the client's type has every route.
    const orpc = {
      googleCal: { events: { move: answer } },
    } as unknown as StateConfig["orpc"];
    const observer = new MutationObserver(
      queryClient,
      moveGoogleEventMutationOptions(queryClient, {
        notifyError: () => undefined,
        orpc,
      })
    );
    await observer.mutate(move).catch(() => undefined);
    return keys.map((key) => queryClient.getQueryState(key)?.isInvalidated);
  });
  expect(await Promise.all(runs)).toEqual([
    [true, true, true, true],
    [true, true, true, true],
  ]);
});
