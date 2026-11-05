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

export const timezoneAtom = atom<string>(getSystemTimeZone());

export const currentDateAtom = atom<Temporal.PlainDate>(todayPlainDate());

const visibleDaysCountBaseAtom = createPersistedAtom<number>(
  "visible-days-count",
  7
);

export const visibleDaysCountAtom = atom(
  (get) => get(visibleDaysCountBaseAtom),
  (_get, set, newValue: number) => {
    const rounded = Math.round(newValue);
    const clamped = Number.isNaN(rounded)
      ? 7
      : Math.max(1, Math.min(7, rounded));
    set(visibleDaysCountBaseAtom, clamped);
  }
);

/** Cap the shared preference at three days for mobile screens. */
export const mobileVisibleDaysCountAtom = atom(
  (get) => Math.min(3, Math.max(1, get(visibleDaysCountAtom))) as 1 | 2 | 3,
  (_get, set, newValue: number) => set(visibleDaysCountAtom, newValue)
);

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

/** Cache one query per calendar and month so views reuse loaded events. See documents/state.md. */
export const eventWindowsAtom = atom((get) => {
  const start = get(currentDateAtom);
  return monthWindows(
    start.subtract({ days: EVENTS_PRELOAD_DAYS }),
    start.add({ days: get(visibleDaysCountAtom) - 1 + EVENTS_PRELOAD_DAYS }),
    get(timezoneAtom)
  );
});

/** Internal refresh signal; components read todayPlainDateAtom or nowZonedDateTimeAtom. See useTodayTick. */
export const todayTickAtom = atom(0);

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

export const nowZonedDateTimeAtom = atom((get) => {
  get(todayTickAtom);
  return Temporal.Now.zonedDateTimeISO(get(timezoneAtom));
});
