import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  getGoogleEventMastersByCalendarQueryKey,
  getGoogleEventsByCalendarQueryKey,
  invalidateGoogleEventQueries,
} from "./google-calendar-query-keys";

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
