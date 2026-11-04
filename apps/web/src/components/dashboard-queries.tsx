"use client";

import { eventWindowAtom } from "@kompose/state/atoms/current-date";
import { resolvedVisibleCalendarIdsAtom } from "@kompose/state/atoms/google-data";
import { tagsQueryAtom } from "@kompose/state/atoms/tags";
import { tasksQueryAtom } from "@kompose/state/atoms/tasks";
import { whoopSummariesByDayAtom } from "@kompose/state/atoms/whoop-data";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useAtomValue } from "jotai";

/**
 * Starts the dashboard's first queries (tasks, tags, linked accounts,
 * calendars, events, WHOOP) while the session check is still in flight, so
 * they run alongside it instead of after it. It subscribes to the same atoms
 * and hooks the dashboard uses, so the dashboard picks up the same cached or
 * in-flight queries when it renders. For a signed-out visitor the requests
 * fail as UNAUTHORIZED, which is neither retried nor reported.
 */
export function DashboardQueries() {
  const visibleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);
  const window = useAtomValue(eventWindowAtom);
  useAtomValue(tasksQueryAtom);
  useAtomValue(tagsQueryAtom);
  useAtomValue(whoopSummariesByDayAtom);
  useGoogleEvents({ visibleCalendars, window });
  return null;
}
