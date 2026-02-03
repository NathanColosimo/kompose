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
 * Ensure visible calendars are initialized to "all" once calendars are known.
 * Also expands the selection when new calendars are added and the user previously
 * had all calendars visible.
 */
export function useEnsureVisibleCalendars(allCalendars: CalendarIdentifier[]) {
  const [visibleCalendars, setVisibleCalendars] = useAtom(visibleCalendarsAtom);
  const previousAllRef = useRef<CalendarIdentifier[]>([]);

  useEffect(() => {
    if (allCalendars.length === 0) {
      previousAllRef.current = allCalendars;
      return;
    }

    if (visibleCalendars === null) {
      previousAllRef.current = allCalendars;
      setVisibleCalendars(allCalendars);
      return;
    }

    if (visibleCalendars.length === 0) {
      previousAllRef.current = allCalendars;
      return;
    }

    const previousAll = previousAllRef.current;
    if (
      previousAll.length > 0 &&
      isSameCalendarSet(visibleCalendars, previousAll) &&
      !isSameCalendarSet(visibleCalendars, allCalendars)
    ) {
      setVisibleCalendars(allCalendars);
    }

    previousAllRef.current = allCalendars;
  }, [allCalendars, setVisibleCalendars, visibleCalendars]);
}
