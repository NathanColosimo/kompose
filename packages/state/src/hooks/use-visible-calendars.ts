"use client";

import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { googleCalendarsDataAtom } from "../atoms/google-data";
import {
  visibleCalendarsAtom,
  visibleCalendarsModeAtom,
  type VisibleCalendars,
} from "../atoms/visible-calendars";

/**
 * Compare two calendar id lists with stable ordering.
 */
function areCalendarListsEqual(
  left: VisibleCalendars,
  right: VisibleCalendars
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      leftItem.accountId !== rightItem.accountId ||
      leftItem.calendarId !== rightItem.calendarId
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Hook wrapper around visibleCalendarsAtom that normalizes "all" mode.
 */
export function useVisibleCalendars() {
  const [visibleCalendars, setVisibleCalendars] = useAtom(visibleCalendarsAtom);
  const [mode, setMode] = useAtom(visibleCalendarsModeAtom);
  const googleCalendars = useAtomValue(googleCalendarsDataAtom);

  const allCalendarIds = useMemo(
    () =>
      googleCalendars.map((calendar) => ({
        accountId: calendar.accountId,
        calendarId: calendar.calendar.id,
      })),
    [googleCalendars]
  );

  const resolvedVisibleCalendars = useMemo(() => {
    if (mode === "custom") {
      return visibleCalendars;
    }
    return allCalendarIds;
  }, [allCalendarIds, mode, visibleCalendars]);

  useEffect(() => {
    if (allCalendarIds.length === 0) {
      return;
    }
    // Initialize to "all" once calendars load.
    if (mode === "unset") {
      setVisibleCalendars(allCalendarIds);
      setMode("all");
      return;
    }
    // Auto-add new calendars while in "all" mode.
    if (mode === "all" && !areCalendarListsEqual(visibleCalendars, allCalendarIds)) {
      setVisibleCalendars(allCalendarIds);
    }
  }, [allCalendarIds, mode, setMode, setVisibleCalendars, visibleCalendars]);

  const setVisibleCalendarsCustom = useCallback(
    (
      update:
        | VisibleCalendars
        | ((prev: VisibleCalendars) => VisibleCalendars)
    ) => {
      setVisibleCalendars((prev) => {
        // Use the resolved list as the base until the user customizes.
        const base = mode === "custom" ? prev : resolvedVisibleCalendars;
        const next = typeof update === "function" ? update(base) : update;
        const isAllSelection =
          allCalendarIds.length > 0 && areCalendarListsEqual(next, allCalendarIds);
        setMode(isAllSelection ? "all" : "custom");
        return next;
      });
    },
    [allCalendarIds, mode, resolvedVisibleCalendars, setMode, setVisibleCalendars]
  );

  const setVisibleCalendarsAll = useCallback(() => {
    setVisibleCalendars(allCalendarIds);
    setMode("all");
  }, [allCalendarIds, setMode, setVisibleCalendars]);

  return {
    visibleCalendars: resolvedVisibleCalendars,
    setVisibleCalendars: setVisibleCalendarsCustom,
    setVisibleCalendarsAll,
  };
}
