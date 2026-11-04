"use client";

import { eventWindowAtom } from "@kompose/state/atoms/current-date";
import { resolvedVisibleCalendarIdsAtom } from "@kompose/state/atoms/google-data";
import { tagsQueryAtom } from "@kompose/state/atoms/tags";
import { tasksQueryAtom } from "@kompose/state/atoms/tasks";
import { whoopSummariesByDayAtom } from "@kompose/state/atoms/whoop-data";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useAtomValue } from "jotai";

/**
 * Subscribes to the dashboard's first queries while the session check is in
 * flight, so they run alongside it; the dashboard then reuses them.
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
