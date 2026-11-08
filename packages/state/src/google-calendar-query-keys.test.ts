import { expect, test } from "bun:test";
import {
  onlineManager,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import {
  getGoogleEventMastersByCalendarQueryKey,
  getGoogleEventsByCalendarQueryKey,
  invalidateGoogleEventQueries,
} from "./google-calendar-query-keys";
import {
  seriesRefreshing,
  seriesRuleReady,
} from "./hooks/use-recurring-event-master";

test("a write to a calendar's events leaves none of its series fresh", async () => {
  // A series saved every two weeks, then reopened: its loaded master must
  // be fetched again, or the next save (a move) writes the old rule back.
  const queryClient = new QueryClient();
  const work = { accountId: "acct", calendarId: "work" };
  const home = { accountId: "acct", calendarId: "home" };
  const master = [...getGoogleEventMastersByCalendarQueryKey(work), "series"];
  const otherMaster = [...getGoogleEventMastersByCalendarQueryKey(home), "s2"];
  const events = [...getGoogleEventsByCalendarQueryKey(work), "a", "b"];
  queryClient.setQueryData(master, { recurrence: ["RRULE:FREQ=WEEKLY"] });
  queryClient.setQueryData(otherMaster, { recurrence: ["RRULE:FREQ=DAILY"] });
  queryClient.setQueryData(events, []);

  await invalidateGoogleEventQueries(queryClient, [work]);

  expect(queryClient.getQueryState(master)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(events)?.isInvalidated).toBe(true);
  // Another calendar's series stays as it was.
  expect(queryClient.getQueryState(otherMaster)?.isInvalidated).toBe(false);
});

test("a stale series isn't ready until its new rule is in", async () => {
  // The editor's series, marked stale by a save: while it's fetched again,
  // its old rule mustn't feed the next save.
  const queryClient = new QueryClient();
  const work = { accountId: "acct", calendarId: "work" };
  const key = [...getGoogleEventMastersByCalendarQueryKey(work), "series"];
  queryClient.setQueryData(key, { recurrence: ["RRULE:FREQ=WEEKLY"] });
  let answer: (value: unknown) => void = () => undefined;
  const observer = new QueryObserver(queryClient, {
    queryFn: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
    queryKey: key,
    staleTime: 5 * 60 * 1000,
  });
  const stop = observer.subscribe(() => undefined);
  expect(seriesRefreshing(observer.getCurrentResult())).toBe(false);

  const invalidated = invalidateGoogleEventQueries(queryClient, [work]);
  expect(seriesRefreshing(observer.getCurrentResult())).toBe(true);
  expect(seriesRuleReady(observer.getCurrentResult())).toBe(false);

  answer({ recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2"] });
  await invalidated;
  expect(seriesRefreshing(observer.getCurrentResult())).toBe(false);
  expect(seriesRuleReady(observer.getCurrentResult())).toBe(true);
  expect(observer.getCurrentResult().data).toEqual({
    recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2"],
  });
  stop();
});

test("a series whose fetch after a write failed stays unusable", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const work = { accountId: "acct", calendarId: "work" };
  const key = [...getGoogleEventMastersByCalendarQueryKey(work), "series"];
  queryClient.setQueryData(key, { recurrence: ["RRULE:FREQ=WEEKLY"] });
  const observer = new QueryObserver(queryClient, {
    queryFn: () => Promise.reject(new Error("offline")),
    queryKey: key,
    staleTime: 5 * 60 * 1000,
  });
  const stop = observer.subscribe(() => undefined);
  expect(seriesRuleReady(observer.getCurrentResult())).toBe(true);
  await invalidateGoogleEventQueries(queryClient, [work]);
  const result = observer.getCurrentResult();
  // The old rule is still cached, but a save mustn't use it.
  expect(result.data).toBeDefined();
  expect(result.isRefetchError).toBe(true);
  expect(seriesRuleReady(result)).toBe(false);
  stop();
});

test("a series whose fetch waits for the network isn't ready", async () => {
  // Offline when a save marks the series stale: its fetch pauses, and the
  // old rule stays unusable until it's back with the new one. (A mounted
  // client hears the network come back.)
  const queryClient = new QueryClient();
  queryClient.mount();
  const work = { accountId: "acct", calendarId: "work" };
  const key = [...getGoogleEventMastersByCalendarQueryKey(work), "series"];
  queryClient.setQueryData(key, { recurrence: ["RRULE:FREQ=WEEKLY"] });
  const observer = new QueryObserver(queryClient, {
    queryFn: () => Promise.resolve({ recurrence: ["RRULE:FREQ=DAILY"] }),
    queryKey: key,
    staleTime: 5 * 60 * 1000,
  });
  const stop = observer.subscribe(() => undefined);
  onlineManager.setOnline(false);
  try {
    invalidateGoogleEventQueries(queryClient, [work]).catch(() => undefined);
    await Promise.resolve();
    const paused = observer.getCurrentResult();
    expect(paused.isPaused).toBe(true);
    expect(seriesRuleReady(paused)).toBe(false);
  } finally {
    onlineManager.setOnline(true);
  }
  // Back online, the paused fetch resumes and the new rule is in.
  const waiting = () => {
    const result = observer.getCurrentResult();
    return result.isPaused || result.isFetching;
  };
  await new Promise<void>((resolve) => {
    if (!waiting()) {
      resolve();
      return;
    }
    const done = observer.subscribe(() => {
      if (!waiting()) {
        done();
        resolve();
      }
    });
  });
  expect(seriesRuleReady(observer.getCurrentResult())).toBe(true);
  expect(observer.getCurrentResult().data).toEqual({
    recurrence: ["RRULE:FREQ=DAILY"],
  });
  stop();
  queryClient.unmount();
});
