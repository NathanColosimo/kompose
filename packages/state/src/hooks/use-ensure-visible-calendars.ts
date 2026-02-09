"use client";

import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import type { CalendarIdentifier } from "../atoms/visible-calendars";
import { visibleCalendarsAtom } from "../atoms/visible-calendars";

function toCalendarKey(calendar: CalendarIdentifier) {
  return `${calendar.accountId}:${calendar.calendarId}`;
}

function isSameCalendarSet(
  a: CalendarIdentifier[],
  b: CalendarIdentifier[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  if (a.length === 0) {
    return true;
  }
  const keys = new Set<string>();
  for (const calendar of b) {
    keys.add(toCalendarKey(calendar));
  }
  for (const calendar of a) {
    if (!keys.has(toCalendarKey(calendar))) {
      return false;
    }
  }
  return true;
}

/**
 * Sanitize stale calendar selections and auto-expand when new calendars appear.
 *
 * `dataReady` must be `true` only when ALL account + calendar queries have
 * resolved (no active fetches).  This prevents the sanitization logic from
 * running against incomplete data and accidentally stripping calendars whose
 * queries haven't returned yet.
 *
 * The `null` value of `visibleCalendarsAtom` is intentionally left alone here
 * — it already means "show all" in `resolvedVisibleCalendarIdsAtom`, and
 * toggle handlers materialise it via `prev ?? allCalendarIds`.
 */
export function useEnsureVisibleCalendars(
  allCalendars: CalendarIdentifier[],
  dataReady: boolean
) {
  const [visibleCalendars, setVisibleCalendars] = useAtom(visibleCalendarsAtom);
  const previousAllRef = useRef<CalendarIdentifier[]>([]);

  useEffect(() => {
    // Skip all logic until every account/calendar query has settled.
    if (!dataReady) {
      return;
    }

    if (allCalendars.length === 0) {
      previousAllRef.current = allCalendars;
      return;
    }

    // null means "show all" — no need to materialise into an explicit array.
    if (visibleCalendars === null || visibleCalendars.length === 0) {
      previousAllRef.current = allCalendars;
      return;
    }

    // Remove stored calendar ids that no longer exist.
    const validCalendarKeys = new Set(allCalendars.map(toCalendarKey));
    const sanitizedVisible = visibleCalendars.filter((calendar) =>
      validCalendarKeys.has(toCalendarKey(calendar))
    );

    if (sanitizedVisible.length !== visibleCalendars.length) {
      previousAllRef.current = allCalendars;
      setVisibleCalendars(
        sanitizedVisible.length > 0 ? sanitizedVisible : allCalendars
      );
      return;
    }

    // Auto-expand: if user previously had all calendars visible and new ones
    // were added, include the new calendars automatically.
    const previousAll = previousAllRef.current;
    if (
      previousAll.length > 0 &&
      isSameCalendarSet(visibleCalendars, previousAll) &&
      !isSameCalendarSet(visibleCalendars, allCalendars)
    ) {
      setVisibleCalendars(allCalendars);
    }

    previousAllRef.current = allCalendars;
  }, [allCalendars, dataReady, setVisibleCalendars, visibleCalendars]);
}
