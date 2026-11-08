import { expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { StateConfig } from "../config";
import { moveGoogleEventMutationOptions } from "./use-move-google-event-mutation";

const move = {
  accountId: "acct",
  calendarId: "work",
  destinationCalendarId: "home",
  eventId: "event",
  scope: "all" as const,
};

/** A move the server refuses, and the errors the app was told about. */
async function failedMove(held: { failureMessage?: string; quiet?: boolean }) {
  const told: Error[] = [];
  const sent: unknown[] = [];
  const orpc = {
    googleCal: {
      events: {
        move: (input: unknown) => {
          sent.push(input);
          return Promise.reject(new Error("refused"));
        },
      },
    },
    // Only the call a move makes: the client's type has every route.
  } as unknown as StateConfig["orpc"];
  const observer = new MutationObserver(
    new QueryClient(),
    moveGoogleEventMutationOptions(new QueryClient(), {
      notifyError: (error) => told.push(error),
      orpc,
    })
  );
  await observer.mutate({ ...move, ...held }).catch(() => undefined);
  return { sent, told };
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
