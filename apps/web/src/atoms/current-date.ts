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
