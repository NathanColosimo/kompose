import { expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { StateConfig } from "../config";
import { getGoogleEventsByCalendarQueryKey } from "../google-calendar-query-keys";
import { deleteGoogleEventMutationOptions } from "./use-google-event-mutations";

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
  expect(cached).toEqual([{ id: "event" }, { id: "other" }]);
});
