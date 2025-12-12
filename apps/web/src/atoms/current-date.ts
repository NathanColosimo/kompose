import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import {
  addDays,
  dateToPlainDate,
  endOfDayZoned,
  endOfMonth,
  getSystemTimeZone,
  plainDateToDate,
  startOfDayZoned,
  startOfMonth,
  subDays,
  todayPlainDate,
} from "@/lib/temporal-utils";

/** User's timezone - defaults to browser/system timezone */
export const timezoneAtom = atom<string>(getSystemTimeZone());

/** Currently selected/visible date for calendar view - defaults to today */
export const currentDateAtom = atom<Date>(
  plainDateToDate(todayPlainDate(), getSystemTimeZone())
);

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
  const start = dateToPlainDate(get(currentDateAtom), get(timezoneAtom));
  const count = get(visibleDaysCountAtom);
  return plainDateToDate(addDays(start, count - 1), get(timezoneAtom));
});

/** Array of dates starting from the current date (length based on visibleDaysCountAtom) */
export const visibleDaysAtom = atom<Date[]>((get) => {
  const start = dateToPlainDate(get(currentDateAtom), get(timezoneAtom));
  const count = get(visibleDaysCountAtom);
  return Array.from({ length: count }, (_, i) =>
    plainDateToDate(addDays(start, i), get(timezoneAtom))
  );
});

const EVENTS_WINDOW_PADDING_DAYS = 15;

function buildEventWindow(center: Date, timeZone: string) {
  const centerPlain = dateToPlainDate(center, timeZone);
  const monthStart = startOfMonth(centerPlain);
  const start = startOfDayZoned(
    subDays(monthStart, EVENTS_WINDOW_PADDING_DAYS),
    timeZone
  );
  const end = endOfDayZoned(
    addDays(endOfMonth(monthStart), EVENTS_WINDOW_PADDING_DAYS),
    timeZone
  );

  return { start, end };
}

export const eventWindowAtom = atom<{ timeMin: string; timeMax: string }>((get) => {
  const { start, end } = buildEventWindow(get(currentDateAtom), get(timezoneAtom));
  return {
    timeMin: start.toInstant().toString(),
    timeMax: end.toInstant().toString(),
  };
});
