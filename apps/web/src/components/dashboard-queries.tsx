"use client";

import { eventWindowsAtom } from "@kompose/state/atoms/current-date";
import { dayMetricsByDayAtom } from "@kompose/state/atoms/day-data";
import { resolvedVisibleCalendarIdsAtom } from "@kompose/state/atoms/google-data";
import { tagsQueryAtom } from "@kompose/state/atoms/tags";
import { tasksQueryAtom } from "@kompose/state/atoms/tasks";
import { useGoogleEvents } from "@kompose/state/hooks/use-google-events";
import { useAtomValue } from "jotai";

/**
 * Subscribes to the dashboard's first queries while the session check is in
 * flight, so they run alongside it; the dashboard then reuses them.
 */
export function DashboardQueries() {
  const visibleCalendars = useAtomValue(resolvedVisibleCalendarIdsAtom);
  const windows = useAtomValue(eventWindowsAtom);
  useAtomValue(tasksQueryAtom);
  useAtomValue(tagsQueryAtom);
  useAtomValue(dayMetricsByDayAtom);
  useGoogleEvents({ visibleCalendars, windows });
  return null;
}
