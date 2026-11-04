import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import { Temporal } from "temporal-polyfill";
import type { GoogleEventsWindow } from "../google-calendar-query-keys";
import { createPersistedAtom } from "../storage";
import {
  getSystemTimeZone,
  startOfDayZoned,
  todayPlainDate,
} from "../temporal-utils";

/**
 * User's timezone - defaults to system timezone.
 */
export const timezoneAtom = atom<string>(getSystemTimeZone());

/**
 * Currently selected/visible date for calendar view - defaults to today.
 */
export const currentDateAtom = atom<Temporal.PlainDate>(todayPlainDate());

/**
 * Number of visible days in the calendar view (1-7) with validation.
 */
const visibleDaysCountBaseAtom = createPersistedAtom<number>(
  "visible-days-count",
  7
);

export const visibleDaysCountAtom = atom(
  (get) => get(visibleDaysCountBaseAtom),
  (_get, set, newValue: number) => {
    // Clamp value to valid range 1-7, defaulting to 7 for invalid inputs.
    const rounded = Math.round(newValue);
    const clamped = Number.isNaN(rounded)
      ? 7
      : Math.max(1, Math.min(7, rounded));
    set(visibleDaysCountBaseAtom, clamped);
  }
);

/**
 * Mobile-specific visible days count, clamped to 1-3.
 * Derives from the shared atom but enforces mobile screen constraints.
 */
export const mobileVisibleDaysCountAtom = atom(
  (get) => Math.min(3, Math.max(1, get(visibleDaysCountAtom))) as 1 | 2 | 3,
  (_get, set, newValue: number) => set(visibleDaysCountAtom, newValue)
);

/**
 * Mobile-specific visible days array, limited to 1-3 days.
 */
export const mobileVisibleDaysAtom = atom<Temporal.PlainDate[]>((get) => {
  const start = get(currentDateAtom);
  const count = get(mobileVisibleDaysCountAtom);
  return Array.from({ length: count }, (_, i) => start.add({ days: i }));
});

/**
 * Days loaded past each end of the visible days. At least one page (up to 7
 * days), so paging forward or back finds the next page's events cached.
 */
const EVENTS_PRELOAD_DAYS = 7;

/** The calendar months, in `timeZone`, that the days from `start` to `end` touch. */
export function monthWindows(
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  timeZone: string
): GoogleEventsWindow[] {
  const windows: GoogleEventsWindow[] = [];
  const last = end.toPlainYearMonth();
  for (
    let month = start.toPlainYearMonth();
    Temporal.PlainYearMonth.compare(month, last) <= 0;
    month = month.add({ months: 1 })
  ) {
    const next = month.add({ months: 1 });
    windows.push({
      timeMax: startOfDayZoned(next.toPlainDate({ day: 1 }), timeZone)
        .toInstant()
        .toString(),
      timeMin: startOfDayZoned(month.toPlainDate({ day: 1 }), timeZone)
        .toInstant()
        .toString(),
    });
  }
  return windows;
}

/**
 * The windows event queries cover: each calendar month that the visible days,
 * plus EVENTS_PRELOAD_DAYS on each side, touch. Each month is one cached query
 * per calendar, shared by every view that shows part of it.
 */
export const eventWindowsAtom = atom((get) => {
  const start = get(currentDateAtom);
  return monthWindows(
    start.subtract({ days: EVENTS_PRELOAD_DAYS }),
    start.add({ days: get(visibleDaysCountAtom) - 1 + EVENTS_PRELOAD_DAYS }),
    get(timezoneAtom)
  );
});

/**
 * Tick counter incremented every 60s and on window focus/visibility to keep
 * today/now atoms fresh. Components should never read this directly — use
 * todayPlainDateAtom or nowZonedDateTimeAtom instead.
 */
export const todayTickAtom = atom(0);

/**
 * Today's date in the user's timezone, reactively refreshed via todayTickAtom.
 * Unlike the stale useMemo approach, this stays correct across midnight
 * boundaries when the app is left open overnight.
 */
const todayPlainDateTickAtom = atom((get) => {
  get(todayTickAtom);
  return todayPlainDate(get(timezoneAtom));
});

// The tick fires every minute and on focus; only hand out a new date (and
// re-render subscribers) when the day actually changes.
export const todayPlainDateAtom = selectAtom(
  todayPlainDateTickAtom,
  (date) => date,
  (previous, next) => previous.equals(next)
);

/**
 * Current ZonedDateTime in the user's timezone, reactively refreshed via
 * todayTickAtom. Used for overdue detection (has a task's end time passed?).
 */
export const nowZonedDateTimeAtom = atom((get) => {
  get(todayTickAtom);
  return Temporal.Now.zonedDateTimeISO(get(timezoneAtom));
});
