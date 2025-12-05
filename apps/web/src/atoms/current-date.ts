import { addDays, startOfToday } from "date-fns";
import { atom } from "jotai";

/** User's timezone - defaults to browser/system timezone */
export const timezoneAtom = atom<string>(
  Intl.DateTimeFormat().resolvedOptions().timeZone
);

/** Currently selected/visible date for calendar view - defaults to today */
export const currentDateAtom = atom<Date>(startOfToday());

/** End of the visible 7-day range */
export const weekEndAtom = atom<Date>((get) => {
  const start = get(currentDateAtom);
  return addDays(start, 6);
});

/** Array of 7 dates starting from the current date */
export const weekDaysAtom = atom<Date[]>((get) => {
  const start = get(currentDateAtom);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
});
