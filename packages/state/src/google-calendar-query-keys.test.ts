import { expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  getGoogleEventMastersByCalendarQueryKey,
  getGoogleEventsByCalendarQueryKey,
  invalidateGoogleEventQueries,
} from "./google-calendar-query-keys";
import { seriesRefreshing } from "./hooks/use-recurring-event-master";

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

  answer({ recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2"] });
  await invalidated;
  expect(seriesRefreshing(observer.getCurrentResult())).toBe(false);
  expect(observer.getCurrentResult().data).toEqual({
    recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2"],
  });
  stop();
});
