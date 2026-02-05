import { atom } from "jotai";
import type { Temporal } from "temporal-polyfill";
import { createPersistedAtom } from "../storage";
import {
  endOfDayZoned,
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
 * Array of PlainDates starting from the current date.
 */
export const visibleDaysAtom = atom<Temporal.PlainDate[]>((get) => {
  const start = get(currentDateAtom);
  const count = get(visibleDaysCountAtom);
  return Array.from({ length: count }, (_, i) => start.add({ days: i }));
});

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

const EVENTS_WINDOW_PADDING_DAYS = 15;

function buildEventWindow(center: Temporal.PlainDate, timeZone: string) {
  const monthStart = center.with({ day: 1 });
  const monthEnd = center.with({ day: center.daysInMonth });

  const start = startOfDayZoned(
    monthStart.subtract({ days: EVENTS_WINDOW_PADDING_DAYS }),
    timeZone
  );
  const end = endOfDayZoned(
    monthEnd.add({ days: EVENTS_WINDOW_PADDING_DAYS }),
    timeZone
  );

  return { start, end };
}

/**
 * Time window (timeMin/timeMax) around the current date for event queries.
 */
export const eventWindowAtom = atom<{ timeMin: string; timeMax: string }>(
  (get) => {
    const { start, end } = buildEventWindow(
      get(currentDateAtom),
      get(timezoneAtom)
    );
    return {
      timeMin: start.toInstant().toString(),
      timeMax: end.toInstant().toString(),
    };
  }
);
