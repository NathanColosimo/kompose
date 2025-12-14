import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Temporal } from "temporal-polyfill";

import {
  endOfDayZoned,
  getSystemTimeZone,
  startOfDayZoned,
  todayPlainDate,
} from "@/lib/temporal-utils";

/** User's timezone - defaults to browser/system timezone */
export const timezoneAtom = atom<string>(getSystemTimeZone());

/** Currently selected/visible date for calendar view - defaults to today */
export const currentDateAtom = atom<Temporal.PlainDate>(todayPlainDate());

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
export const visibleDaysEndAtom = atom<Temporal.PlainDate>((get) => {
  const start = get(currentDateAtom);
  const count = get(visibleDaysCountAtom);
  return start.add({ days: count - 1 });
});

/** Array of PlainDates starting from the current date (length based on visibleDaysCountAtom) */
export const visibleDaysAtom = atom<Temporal.PlainDate[]>((get) => {
  const start = get(currentDateAtom);
  const count = get(visibleDaysCountAtom);
  return Array.from({ length: count }, (_, i) => start.add({ days: i }));
});

const EVENTS_WINDOW_PADDING_DAYS = 15;

/** Build event window around a PlainDate center */
function buildEventWindow(center: Temporal.PlainDate, timeZone: string) {
  // Get first day of the month
  const monthStart = center.with({ day: 1 });
  // Get last day of the month
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
