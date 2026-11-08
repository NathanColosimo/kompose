import { expect, test } from "bun:test";
import type { CreateEventInput } from "@kompose/api/routers/google-cal/contract";
import { sanitizeEventPayload } from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { StateConfig } from "../config";
import { getGoogleEventsByCalendarQueryKey } from "../google-calendar-query-keys";
import {
  createGoogleEventMutationOptions,
  deleteGoogleEventMutationOptions,
  type UpdateGoogleEventVariables,
  updateGoogleEventMutationOptions,
} from "./use-google-event-mutations";

const calendar = { accountId: "acct", calendarId: "work" };
/** The calendar's November list, as the events query caches it. */
const november = [...getGoogleEventsByCalendarQueryKey(calendar), "2026-11"];
const october = [...getGoogleEventsByCalendarQueryKey(calendar), "2026-10"];
const standup: Event = {
  end: { dateTime: "2026-11-09T09:30:00-05:00" },
  id: "event",
  start: { dateTime: "2026-11-09T09:00:00-05:00" },
  summary: "Standup",
};

type Route = "create" | "delete" | "update";

/**
 * A client whose one route answers with `answer`, after `meanwhile` (the
 * realtime sync refreshing the cache while the write is out), and what it
 * was sent and saw. Only that route is stubbed: the client's type has
 * every route.
 */
function stubbedServer(
  queryClient: QueryClient,
  route: Route,
  answer: () => Promise<unknown>,
  meanwhile: () => void = () => undefined
) {
  const sent: unknown[] = [];
  const whileSent: unknown[] = [];
  const orpc = {
    googleCal: {
      events: {
        [route]: (input: unknown) => {
          sent.push(input);
          whileSent.push(queryClient.getQueryData(november));
          meanwhile();
          return answer();
        },
      },
    },
  } as unknown as StateConfig["orpc"];
  return { orpc, sent, whileSent };
}

const refused = () => Promise.reject(new Error("refused"));

// --- delete ---

const removal = { ...calendar, eventId: "event", scope: "following" as const };

/**
 * A delete the server refuses, after the realtime sync gives November
 * `refreshed`, and what the app and cache were left with.
 */
async function failedDelete(
  held: { failureMessage?: string; quiet?: boolean },
  refreshed: unknown[] = [{ id: "other" }, { id: "new" }]
) {
  const told: Error[] = [];
  const queryClient = new QueryClient();
  queryClient.setQueryData(november, [{ id: "event" }, { id: "other" }]);
  // October's list doesn't have it.
  queryClient.setQueryData(october, [{ id: "earlier" }]);
  const server = stubbedServer(queryClient, "delete", refused, () =>
    queryClient.setQueryData(november, refreshed)
  );
  const observer = new MutationObserver(
    queryClient,
    deleteGoogleEventMutationOptions(queryClient, {
      notifyError: (error) => told.push(error),
      orpc: server.orpc,
    })
  );
  await observer.mutate({ ...removal, ...held }).catch(() => undefined);
  return {
    novemberAfter: queryClient.getQueryData(november),
    octoberAfter: queryClient.getQueryData(october),
    sent: server.sent,
    told,
    whileSent: server.whileSent,
  };
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
  const { novemberAfter, octoberAfter, sent, whileSent } = await failedDelete({
    quiet: true,
  });
  expect(sent).toEqual([removal]);
  expect(whileSent).toEqual([[{ id: "other" }]]);
  // Only the deleted event comes back, to the list it left: what the
  // refetch brought stays, and October doesn't gain it.
  expect(novemberAfter).toEqual([
    { id: "other" },
    { id: "new" },
    { id: "event" },
  ]);
  expect(octoberAfter).toEqual([{ id: "earlier" }]);
});

test("a failed delete doesn't add the event twice where a refetch brought it", async () => {
  // The server still had it while the delete was out.
  const refreshed = [{ id: "event" }, { id: "new" }];
  const { novemberAfter } = await failedDelete({ quiet: true }, refreshed);
  expect(novemberAfter).toEqual(refreshed);
});

// --- update ---

/**
 * An update of the Standup with `variables` (a rename to Planning), which
 * the server answers with `answer` after `before` sets up the cache and
 * `meanwhile` refreshes it; and what the server was sent, what the app
 * was told, what November's list was while it was sent, and November's
 * and October's lists after it.
 */
async function update(params: {
  answer: () => Promise<unknown>;
  before?: (queryClient: QueryClient) => void;
  meanwhile?: (queryClient: QueryClient) => void;
  variables?: Partial<UpdateGoogleEventVariables>;
}) {
  const told: Error[] = [];
  const queryClient = new QueryClient();
  queryClient.setQueryData(november, [standup]);
  params.before?.(queryClient);
  const server = stubbedServer(queryClient, "update", params.answer, () =>
    params.meanwhile?.(queryClient)
  );
  const observer = new MutationObserver(
    queryClient,
    updateGoogleEventMutationOptions(queryClient, {
      notifyError: (error) => told.push(error),
      orpc: server.orpc,
    })
  );
  await observer
    .mutate({
      ...calendar,
      event: { ...standup, summary: "Planning" },
      eventId: "event",
      ...params.variables,
    })
    .catch(() => undefined);
  return {
    after: queryClient.getQueryData(november),
    octoberAfter: queryClient.getQueryData(october),
    sent: server.sent,
    told,
    whileSent: server.whileSent,
  };
}

/** The realtime sync brings another event while the write is out. */
const anotherEvent = (queryClient: QueryClient) =>
  queryClient.setQueryData(november, [
    ...(queryClient.getQueryData<Event[]>(november) ?? []),
    { id: "new" },
  ]);

test("an update sends its scope and event, not the editor's options", async () => {
  const planning = sanitizeEventPayload({ ...standup, summary: "Planning" });
  const { sent } = await update({
    answer: refused,
    variables: {
      failureMessage: "x",
      optimistic: false,
      quiet: true,
      recurrenceScope: "all",
    },
  });
  expect(sent).toEqual([
    { ...calendar, event: planning, eventId: "event", scope: "all" },
  ]);
  // With no scope given, the save is for this occurrence.
  const { sent: plain } = await update({ answer: refused });
  expect(plain).toEqual([
    { ...calendar, event: planning, eventId: "event", scope: "this" },
  ]);
});

test("a failed update says what failed, in the editor's words, unless quiet", async () => {
  const { told } = await update({
    answer: refused,
    variables: { failureMessage: "Couldn't save it." },
  });
  expect(told.map((error) => error.message)).toEqual(["Couldn't save it."]);
  expect(told[0]?.cause).toEqual(new Error("refused"));
  const { told: quiet } = await update({
    answer: refused,
    variables: { quiet: true },
  });
  expect(quiet).toEqual([]);
});

test("a failed held update leaves the list as it's since been refreshed", async () => {
  // It changed nothing before the server answered, so nothing goes back.
  const results = await Promise.all(
    (["all", "this"] as const).map((recurrenceScope) =>
      update({
        answer: refused,
        meanwhile: anotherEvent,
        variables: { optimistic: false, quiet: true, recurrenceScope },
      })
    )
  );
  for (const { after } of results) {
    expect(after).toEqual([standup, { id: "new" }]);
  }
});

test("a held update of one occurrence shows the server's copy once it's in", async () => {
  // With no scope given, the save is for this occurrence.
  const saved = { id: "event", summary: "Planning (saved)" };
  const { after } = await update({
    answer: () => Promise.resolve(saved),
    meanwhile: anotherEvent,
    variables: { optimistic: false, quiet: true },
  });
  expect(after).toEqual([saved, { id: "new" }]);
});

test("a failed optimistic update puts back only that event", async () => {
  const { after, whileSent } = await update({
    answer: refused,
    meanwhile: anotherEvent,
  });
  expect(whileSent).toEqual([[{ ...standup, summary: "Planning" }]]);
  expect(after).toEqual([standup, { id: "new" }]);
});

test("a failed optimistic update puts each list's own copy back", async () => {
  // Over the month's end, the event is in October's list too, there in an
  // older copy than November's.
  const older = { ...standup, summary: "Old title" };
  const { after, octoberAfter } = await update({
    answer: refused,
    before: (queryClient) => queryClient.setQueryData(october, [older]),
  });
  expect(octoberAfter).toEqual([older]);
  expect(after).toEqual([standup]);
});

test("a failed optimistic update keeps a newer copy of the event", async () => {
  // Renamed on another device while the save was out: that copy stays.
  const renamed = { ...standup, summary: "Renamed elsewhere" };
  const { after } = await update({
    answer: refused,
    meanwhile: (queryClient) => queryClient.setQueryData(november, [renamed]),
  });
  expect(after).toEqual([renamed]);
});

// --- create ---

const lunch: CreateEventInput = {
  ...calendar,
  event: {
    end: { dateTime: "2026-11-09T12:30:00-05:00" },
    start: { dateTime: "2026-11-09T12:00:00-05:00" },
    summary: "Lunch",
  },
};

/**
 * A create of `input` with the editor's `held` options, which the server
 * answers with `answer` after the realtime sync brings another event; and
 * what the server was sent, what the app was told, November's list while
 * it was sent, and after.
 */
async function create(params: {
  answer: () => Promise<unknown>;
  held?: { failureMessage?: string; quiet?: boolean };
  input?: CreateEventInput;
}) {
  const told: Error[] = [];
  const queryClient = new QueryClient();
  queryClient.setQueryData(november, [{ id: "other" }]);
  const server = stubbedServer(queryClient, "create", params.answer, () =>
    anotherEvent(queryClient)
  );
  const observer = new MutationObserver(
    queryClient,
    createGoogleEventMutationOptions(queryClient, {
      notifyError: (error) => told.push(error),
      orpc: server.orpc,
    })
  );
  await observer
    .mutate({ ...(params.input ?? lunch), ...params.held })
    .catch(() => undefined);
  return {
    after: queryClient.getQueryData(november),
    sent: server.sent,
    told,
    whileSent: server.whileSent,
  };
}

test("a create sends the event, not the editor's options", async () => {
  const { sent } = await create({
    answer: refused,
    held: { failureMessage: "x", quiet: true },
  });
  expect(sent).toEqual([lunch]);
});

test("a failed create says what failed, in the editor's words, unless quiet", async () => {
  const { told } = await create({
    answer: refused,
    held: { failureMessage: "Couldn't create it." },
  });
  expect(told.map((error) => error.message)).toEqual(["Couldn't create it."]);
  expect(told[0]?.cause).toEqual(new Error("refused"));
  const { told: quiet } = await create({
    answer: refused,
    held: { quiet: true },
  });
  expect(quiet).toEqual([]);
});

test("a failed create takes back only the event it added", async () => {
  const { after, whileSent } = await create({ answer: refused });
  // The stand-in showed while the create was out.
  expect(whileSent).toEqual([
    [{ id: "other" }, expect.objectContaining({ summary: "Lunch" })],
  ]);
  expect(after).toEqual([{ id: "other" }, { id: "new" }]);
});

test("a create's stand-in gives way to the server's copy", async () => {
  const saved = { ...lunch.event, id: "lunch" };
  const { after } = await create({ answer: () => Promise.resolve(saved) });
  expect(after).toEqual([{ id: "other" }, saved, { id: "new" }]);
});

test("a repeating create shows no stand-in: its meetings come with the refetch", async () => {
  const weekly: CreateEventInput = {
    ...lunch,
    event: { ...lunch.event, recurrence: ["RRULE:FREQ=WEEKLY"] },
  };
  const { whileSent } = await create({ answer: refused, input: weekly });
  expect(whileSent).toEqual([[{ id: "other" }]]);
});
