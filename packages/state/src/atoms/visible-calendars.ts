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
 */
export type VisibleCalendars = CalendarIdentifier[];

/**
 * Persisted visibility mode to distinguish defaults from user customizations.
 *
 * - `unset`: no user choice yet (defaults to "all")
 * - `all`: keep all calendars visible (auto-add new calendars)
 * - `custom`: explicit user selection (may be empty to hide all)
 */
export type VisibleCalendarsMode = "unset" | "all" | "custom";

/**
 * Atom to store which calendars are currently visible.
 */
const rawVisibleCalendarsAtom = createPersistedAtom<VisibleCalendars | null>(
  "visible-calendars",
  null
);

/**
 * Public atom that normalizes legacy `null` storage into an empty list.
 */
export const visibleCalendarsAtom = atom(
  (get) => get(rawVisibleCalendarsAtom) ?? [],
  (
    get,
    set,
    update: VisibleCalendars | ((prev: VisibleCalendars) => VisibleCalendars)
  ) => {
    const prev = get(rawVisibleCalendarsAtom) ?? [];
    const next =
      typeof update === "function"
        ? (update as (prev: VisibleCalendars) => VisibleCalendars)(prev)
        : update;
    set(rawVisibleCalendarsAtom, next);
  }
);

/**
 * Tracks whether the user is in "all" or "custom" mode.
 */
export const visibleCalendarsModeAtom = createPersistedAtom<VisibleCalendarsMode>(
  "visible-calendars-mode",
  "unset"
);

/**
 * Helper to check if a specific calendar is visible.
 */
export function isCalendarVisible(
  visibleCalendars: VisibleCalendars,
  accountId: string,
  calendarId: string
): boolean {
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
