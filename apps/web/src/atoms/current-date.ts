import { addDays, endOfWeek, startOfToday, startOfWeek } from "date-fns";
import { atom } from "jotai";

/** User's timezone - defaults to browser/system timezone */
export const timezoneAtom = atom<string>(
  Intl.DateTimeFormat().resolvedOptions().timeZone
);

/** Currently selected/visible date for calendar view - defaults to today */
export const currentDateAtom = atom<Date>(startOfToday());

/** Start of the week containing the current date (Sunday) */
export const weekStartAtom = atom<Date>((get) => {
  const currentDate = get(currentDateAtom);
  return startOfWeek(currentDate, { weekStartsOn: 0 });
});

/** End of the week containing the current date (Saturday) */
export const weekEndAtom = atom<Date>((get) => {
  const currentDate = get(currentDateAtom);
  return endOfWeek(currentDate, { weekStartsOn: 0 });
});

/** Array of 7 dates for the current week (Sun-Sat) */
export const weekDaysAtom = atom<Date[]>((get) => {
  const weekStart = get(weekStartAtom);
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
});

/** Number of days to buffer before and after center date for infinite scroll */
export const DAYS_BUFFER = 14;

/** Number of days visible in the viewport at once */
export const VISIBLE_DAYS = 7;

/**
 * Center date for the buffer - separate from currentDateAtom to prevent
 * buffer regeneration on every scroll. Only changes when we need to extend the buffer.
 */
export const bufferCenterAtom = atom<Date>(startOfToday());

/**
 * Buffered array of dates for infinite horizontal scroll.
 * Generates DAYS_BUFFER days before and after the buffer center (total ~57 days).
 * Derived from bufferCenterAtom, NOT currentDateAtom, to stay stable during scrolling.
 */
export const bufferedDaysAtom = atom<Date[]>((get) => {
  const centerDate = get(bufferCenterAtom);
  const totalDays = DAYS_BUFFER * 2 + 1;
  // Start from DAYS_BUFFER days before center date
  const startDate = addDays(centerDate, -DAYS_BUFFER);
  return Array.from({ length: totalDays }, (_, i) => addDays(startDate, i));
});
