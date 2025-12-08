import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** Type representing a calendar identifier with its account */
export type CalendarIdentifier = {
  accountId: string;
  calendarId: string;
};

/**
 * Atom to store which calendars are currently visible.
 * This is persisted to localStorage so user preferences are maintained.
 *
 * When empty, all calendars are shown (default behavior).
 * When populated, only calendars in the set are shown.
 */
export const visibleCalendarsAtom = atomWithStorage<
  CalendarIdentifier[] | null
>("visible-calendars", null, undefined, { getOnInit: true });

/**
 * Helper atom to check if a specific calendar is visible.
 * Returns true if the calendar is in the visible set, or if the set is empty (show all).
 */
export const isCalendarVisibleAtom = atom(
  (get) => (accountId: string, calendarId: string) => {
    const visibleCalendars = get(visibleCalendarsAtom);
    // When null, we treat as "all visible" (default until user picks)
    if (visibleCalendars === null) {
      return true;
    }
    // If explicitly empty, user has hidden all
    if (visibleCalendars.length === 0) {
      return false;
    }
    return visibleCalendars.some(
      (c) => c.accountId === accountId && c.calendarId === calendarId
    );
  }
);

/**
 * Helper function to create a unique key for a calendar.
 */
export function calendarKey(accountId: string, calendarId: string): string {
  return `${accountId}:${calendarId}`;
}
