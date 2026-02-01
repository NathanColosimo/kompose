"use client";

import { useAtom } from "jotai";
import { visibleCalendarsAtom } from "../atoms/visible-calendars";

/**
 * Hook wrapper around visibleCalendarsAtom to mirror the mobile API.
 */
export function useVisibleCalendars() {
  const [visibleCalendars, setVisibleCalendars] = useAtom(visibleCalendarsAtom);
  return { visibleCalendars, setVisibleCalendars };
}
