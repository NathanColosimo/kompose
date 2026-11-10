import { expect, test } from "bun:test";
import type { CreateEventInput } from "@kompose/api/routers/google-cal/contract";
import { sanitizeEventPayload } from "@kompose/google-cal/recurrence-utils";
import type { Event } from "@kompose/google-cal/schema";
import {
  MutationObserver,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import type { StateConfig } from "../config";
import {
  getGoogleEventMastersByCalendarQueryKey,
  getGoogleEventsByCalendarQueryKey,
} from "../google-calendar-query-keys";
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

const failed = () => Promise.reject(new Error("failed"));

// --- delete ---

const removal = { ...calendar, eventId: "event", scope: "following" as const };

/**
 * A delete the server fails, after the realtime sync gives November
 * `refreshed`, and what the app and cache were left with.
 */
async function failedDelete(
  held: { failureMessage?: string },
  refreshed: unknown[] = [{ id: "other" }, { id: "new" }]
) {
  const told: Error[] = [];
  const queryClient = new QueryClient();
  queryClient.setQueryData(november, [{ id: "event" }, { id: "other" }]);
  // October's list doesn't have it.
  queryClient.setQueryData(october, [{ id: "earlier" }]);
  const server = stubbedServer(queryClient, "delete", failed, () =>
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

test("a failed delete reports the server error", async () => {
  const { told } = await failedDelete({});
  expect(told.map((error) => error.message)).toEqual(["failed"]);
});

test("a failed delete otherwise says what failed, in the dialog's words", async () => {
  const { told } = await failedDelete({
    failureMessage: "Couldn't delete it.",
  });
  expect(told.map((error) => error.message)).toEqual(["Couldn't delete it."]);
  expect(told[0]?.cause).toEqual(new Error("failed"));
});

test("the event leaves the list at once, and comes back on failure", async () => {
  const { novemberAfter, octoberAfter, sent, whileSent } = await failedDelete(
    {}
  );
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
  const { novemberAfter } = await failedDelete({}, refreshed);
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
    answer: failed,
    variables: {
      failureMessage: "x",
      optimistic: false,
      recurrenceScope: "all",
    },
  });
  expect(sent).toEqual([
    { ...calendar, event: planning, eventId: "event", scope: "all" },
  ]);
  // With no scope given, the save is for this occurrence.
  const { sent: plain } = await update({ answer: failed });
  expect(plain).toEqual([
    { ...calendar, event: planning, eventId: "event", scope: "this" },
  ]);
});

test("a failed update says what failed, in the editor's words", async () => {
  const { told } = await update({
    answer: failed,
    variables: { failureMessage: "Couldn't save it." },
  });
  expect(told.map((error) => error.message)).toEqual(["Couldn't save it."]);
  expect(told[0]?.cause).toEqual(new Error("failed"));
});

test("a failed held update leaves the list as it's since been refreshed", async () => {
  // It changed nothing before the server answered, so nothing goes back.
  const results = await Promise.all(
    (["all", "this"] as const).map((recurrenceScope) =>
      update({
        answer: failed,
        meanwhile: anotherEvent,
        variables: { optimistic: false, recurrenceScope },
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
    variables: { optimistic: false },
  });
  expect(after).toEqual([saved, { id: "new" }]);
});

test("a failed optimistic update puts back only that event", async () => {
  const { after, whileSent } = await update({
    answer: failed,
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
    answer: failed,
    before: (queryClient) => queryClient.setQueryData(october, [older]),
  });
  expect(octoberAfter).toEqual([older]);
  expect(after).toEqual([standup]);
});

test("a failed optimistic update keeps a newer copy of the event", async () => {
  // Renamed on another device while the save was out: that copy stays.
  const renamed = { ...standup, summary: "Renamed elsewhere" };
  const { after } = await update({
    answer: failed,
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
  held?: { failureMessage?: string };
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
    answer: failed,
    held: { failureMessage: "x" },
  });
  expect(sent).toEqual([lunch]);
});

test("a failed create says what failed, in the editor's words", async () => {
  const { told } = await create({
    answer: failed,
    held: { failureMessage: "Couldn't create it." },
  });
  expect(told.map((error) => error.message)).toEqual(["Couldn't create it."]);
  expect(told[0]?.cause).toEqual(new Error("failed"));
});

test("a failed create takes back only the event it added", async () => {
  const { after, whileSent } = await create({ answer: failed });
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
  const { whileSent } = await create({ answer: failed, input: weekly });
  expect(whileSent).toEqual([[{ id: "other" }]]);
});

// --- every write ---

test("every write marks the calendar's events and series stale, saved or failed", async () => {
  // A series kept fresh past a write would hand its old rule to the next.
  const seriesKey = [
    ...getGoogleEventMastersByCalendarQueryKey(calendar),
    "series",
  ];
  const config = (orpc: StateConfig["orpc"]) => ({
    notifyError: () => undefined,
    orpc,
  });
  /** Each write, run once on `queryClient` against `orpc`. */
  const writes: Record<
    Route,
    (queryClient: QueryClient, orpc: StateConfig["orpc"]) => Promise<unknown>
  > = {
    create: (queryClient, orpc) =>
      new MutationObserver(
        queryClient,
        createGoogleEventMutationOptions(queryClient, config(orpc))
      ).mutate(lunch),
    delete: (queryClient, orpc) =>
      new MutationObserver(
        queryClient,
        deleteGoogleEventMutationOptions(queryClient, config(orpc))
      ).mutate(removal),
    update: (queryClient, orpc) =>
      new MutationObserver(
        queryClient,
        updateGoogleEventMutationOptions(queryClient, config(orpc))
      ).mutate({ ...calendar, event: standup, eventId: "event" }),
  };
  const answers = [() => Promise.resolve(standup), failed];
  const routes: Route[] = ["create", "delete", "update"];
  const runs = routes.flatMap((route) =>
    answers.map(async (answer) => {
      const queryClient = new QueryClient();
      queryClient.setQueryData(november, [standup]);
      queryClient.setQueryData(seriesKey, standup);
      const server = stubbedServer(queryClient, route, answer);
      await writes[route](queryClient, server.orpc).catch(() => undefined);
      return [
        queryClient.getQueryState(november)?.isInvalidated,
        queryClient.getQueryState(seriesKey)?.isInvalidated,
      ];
    })
  );
  expect(await Promise.all(runs)).toEqual(
    Array.from({ length: 6 }, () => [true, true])
  );
});

// --- offline ---

test("a write made offline fails at once instead of waiting for the connection", async () => {
  // An editor holds open until its save settles: a write that waited for
  // the connection would hold it, and the page under it, for as long as
  // the browser stayed offline.
  onlineManager.setOnline(false);
  try {
    const queryClient = new QueryClient();
    queryClient.setQueryData(november, [standup]);
    const offline = () => Promise.reject(new Error("Failed to fetch"));
    const config = (orpc: StateConfig["orpc"]) => ({
      notifyError: () => undefined,
      orpc,
    });
    const settled = (write: Promise<unknown>) =>
      Promise.race([
        write.then(
          () => "saved",
          () => "failed"
        ),
        // Long enough for a rejected write to settle; a paused one never does.
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
      ]);
    expect(
      await Promise.all([
        settled(
          new MutationObserver(
            queryClient,
            createGoogleEventMutationOptions(
              queryClient,
              config(stubbedServer(queryClient, "create", offline).orpc)
            )
          ).mutate(lunch)
        ),
        settled(
          new MutationObserver(
            queryClient,
            updateGoogleEventMutationOptions(
              queryClient,
              config(stubbedServer(queryClient, "update", offline).orpc)
            )
          ).mutate({ ...calendar, event: standup, eventId: "event" })
        ),
        settled(
          new MutationObserver(
            queryClient,
            deleteGoogleEventMutationOptions(
              queryClient,
              config(stubbedServer(queryClient, "delete", offline).orpc)
            )
          ).mutate(removal)
        ),
      ])
    ).toEqual(["failed", "failed", "failed"]);
  } finally {
    onlineManager.setOnline(true);
  }
});
