import {
  addDays,
  endOfDay,
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfToday,
  subDays,
} from "date-fns";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/** User's timezone - defaults to browser/system timezone */
export const timezoneAtom = atom<string>(
  Intl.DateTimeFormat().resolvedOptions().timeZone
);

/** Currently selected/visible date for calendar view - defaults to today */
export const currentDateAtom = atom<Date>(startOfToday());

/** Number of visible days in the calendar view (1-7) with validation */
const visibleDaysCountBaseAtom = atomWithStorage<number>(
  "visible-days-count",
  7,
  undefined,
  { getOnInit: true }
);
export const visibleDaysCountAtom = atom(
  (get) => get(visibleDaysCountBaseAtom),
  (_get, set, newValue: number) => {
    // Clamp value to valid range 1-7, defaulting to 7 for invalid inputs
    const rounded = Math.round(newValue);
    const clamped = Number.isNaN(rounded)
      ? 7
      : Math.max(1, Math.min(7, rounded));
    set(visibleDaysCountBaseAtom, clamped);
  }
);

/** End of the visible day range (based on visibleDaysCountAtom) */
export const visibleDaysEndAtom = atom<Date>((get) => {
  const start = get(currentDateAtom);
  const count = get(visibleDaysCountAtom);
  return addDays(start, count - 1);
});

/** Array of dates starting from the current date (length based on visibleDaysCountAtom) */
export const visibleDaysAtom = atom<Date[]>((get) => {
  const start = get(currentDateAtom);
  const count = get(visibleDaysCountAtom);
  return Array.from({ length: count }, (_, i) => addDays(start, i));
});

const EVENTS_WINDOW_PADDING_DAYS = 15;

function buildEventWindow(center: Date) {
  const monthStart = startOfMonth(center);
  const start = startOfDay(subDays(monthStart, EVENTS_WINDOW_PADDING_DAYS));
  const end = endOfDay(
    addDays(endOfMonth(monthStart), EVENTS_WINDOW_PADDING_DAYS)
  );

  return { start, end };
}

export const eventWindowAtom = atom<{ timeMin: string; timeMax: string }>(
  (get) => {
    const { start, end } = buildEventWindow(get(currentDateAtom));
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  }
);
