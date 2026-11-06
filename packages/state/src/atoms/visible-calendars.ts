import { createPersistedAtom } from "../storage";

export interface CalendarIdentifier {
  accountId: string;
  calendarId: string;
}

/**
 * Persisted calendar visibility selection.
 *
 * - `null`: no explicit saved preference yet
 * - `[]`: explicitly hide all calendars
 * - `[...ids]`: only those calendars visible
 */
export type VisibleCalendars = CalendarIdentifier[] | null;

/** Missing storage stays null; resolvedVisibleCalendarIdsAtom derives the visible set. */
const VISIBLE_CALENDARS_STORAGE_KEY = "visible-calendars";

export const {
  stateAtom: visibleCalendarsStateAtom,
  valueAtom: visibleCalendarsAtom,
} = createPersistedAtom<VisibleCalendars>(VISIBLE_CALENDARS_STORAGE_KEY, null);

export function isCalendarVisible(
  visibleCalendars: VisibleCalendars,
  accountId: string,
  calendarId: string
): boolean {
  if (visibleCalendars === null) {
    return false;
  }
  if (visibleCalendars.length === 0) {
    return false;
  }
  return visibleCalendars.some(
    (c) => c.accountId === accountId && c.calendarId === calendarId
  );
}

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
