import { atom } from "jotai";
import { getStorageAdapter } from "../storage";

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
 * - `null`: no explicit saved preference yet
 * - `[]`: explicitly hide all calendars
 * - `[...ids]`: only those calendars visible
 */
export type VisibleCalendars = CalendarIdentifier[] | null;

/**
 * Atom to store which calendars are currently visible.
 * A missing persisted value stays `null`; callers derive the effective
 * "show all loaded calendars" behavior at read time.
 */
const VISIBLE_CALENDARS_STORAGE_KEY = "visible-calendars";

interface VisibleCalendarsState {
  hydrated: boolean;
  value: VisibleCalendars;
}

function parseVisibleCalendars(raw: string | null): VisibleCalendars {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as VisibleCalendars;
  } catch {
    return null;
  }
}

const visibleCalendarsStateAtom = atom<VisibleCalendarsState>({
  hydrated: false,
  value: null,
});

visibleCalendarsStateAtom.onMount = (setState) => {
  const adapter = getStorageAdapter();
  if (!adapter) {
    setState((prev) => ({ ...prev, hydrated: true }));
    return;
  }

  const apply = (raw: string | null) => {
    setState({
      hydrated: true,
      value: parseVisibleCalendars(raw),
    });
  };
  const markHydrated = () => {
    setState((prev) => ({ ...prev, hydrated: true }));
  };
  const read = adapter.getItem(VISIBLE_CALENDARS_STORAGE_KEY);

  if (read && typeof (read as Promise<string | null>).then === "function") {
    (read as Promise<string | null>).then(apply).catch(markHydrated);
  } else {
    apply(read as string | null);
  }
};

export const visibleCalendarsAtom = atom(
  (get) => get(visibleCalendarsStateAtom).value,
  (
    get,
    set,
    update: VisibleCalendars | ((prev: VisibleCalendars) => VisibleCalendars)
  ) => {
    const current = get(visibleCalendarsStateAtom);
    const next =
      typeof update === "function"
        ? (update as (prev: VisibleCalendars) => VisibleCalendars)(
            current.value
          )
        : update;

    // Keep the hydration bit stable so later writes do not flip readiness.
    set(visibleCalendarsStateAtom, {
      hydrated: current.hydrated,
      value: next,
    });

    const adapter = getStorageAdapter();
    if (!adapter) {
      return;
    }
    adapter.setItem(VISIBLE_CALENDARS_STORAGE_KEY, JSON.stringify(next));
  }
);

/**
 * Tracks when the persisted calendar selection has been read from storage.
 */
export const visibleCalendarsHydratedAtom = atom(
  (get) => get(visibleCalendarsStateAtom).hydrated
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
    return false;
  }
  if (visibleCalendars.length === 0) {
    return false;
  }
  return visibleCalendars.some(
    (c) => c.accountId === accountId && c.calendarId === calendarId
  );
}

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
