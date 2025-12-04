import { startOfToday } from "date-fns";
import { atom } from "jotai";

/** User's timezone - defaults to browser/system timezone */
export const timezoneAtom = atom<string>(
  Intl.DateTimeFormat().resolvedOptions().timeZone
);

/** Currently selected date for calendar view - defaults to today */
export const currentDateAtom = atom<Date>(startOfToday());
