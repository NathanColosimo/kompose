import { addDays, endOfWeek, startOfToday, startOfWeek } from "date-fns";
import { atom } from "jotai";

/** User's timezone - defaults to browser/system timezone */
export const timezoneAtom = atom<string>(
  Intl.DateTimeFormat().resolvedOptions().timeZone
);

/** Currently selected date for calendar view - defaults to today */
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
