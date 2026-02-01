import { atom } from "jotai";
import { createPersistedAtom } from "../storage";

/**
 * Identifies a Google calendar within a specific linked Google account.
 */
export interface CalendarIdentifier {
  accountId: string;
  calendarId: string;
}

/**
 * Persisted calendar visibility selection.
 *
 * - `null`: treat as "all calendars visible" (default)
 * - `[]`: explicitly hide all calendars
 * - `[...ids]`: only those calendars visible
 */
export type VisibleCalendars = CalendarIdentifier[] | null;

/**
 * Atom to store which calendars are currently visible.
 */
export const visibleCalendarsAtom = createPersistedAtom<VisibleCalendars>(
  "visible-calendars",
  null
);

/**
 * Helper to check if a specific calendar is visible.
 */
export function isCalendarVisible(
  visibleCalendars: VisibleCalendars,
  accountId: string,
  calendarId: string
): boolean {
  if (visibleCalendars === null) {
    return true;
  }
  if (visibleCalendars.length === 0) {
    return false;
  }
  return visibleCalendars.some(
    (c) => c.accountId === accountId && c.calendarId === calendarId
  );
}

/**
 * Atom-backed variant of isCalendarVisible for Jotai consumers.
 */
export const isCalendarVisibleAtom = atom(
  (get) => (accountId: string, calendarId: string) => {
    const visibleCalendars = get(visibleCalendarsAtom);
    return isCalendarVisible(visibleCalendars, accountId, calendarId);
  }
);

/**
 * Toggle a calendar identifier in the visible set.
 */
export function toggleCalendarSelection(
  prev: CalendarIdentifier[],
  target: CalendarIdentifier
): CalendarIdentifier[] {
  if (prev.length === 0) {
    return [target];
  }

  const exists = prev.some(
    (c) =>
      c.accountId === target.accountId && c.calendarId === target.calendarId
  );

  return exists
    ? prev.filter(
        (c) =>
          !(
            c.accountId === target.accountId &&
            c.calendarId === target.calendarId
          )
      )
    : [...prev, target];
}
