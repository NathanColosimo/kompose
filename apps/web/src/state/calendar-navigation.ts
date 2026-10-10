import {
  currentDateAtom,
  timezoneAtom,
  todayTickAtom,
} from "@kompose/state/atoms/current-date";
import { atom } from "jotai";
import { Temporal } from "temporal-polyfill";

/** One-shot scroll target, consumed once the calendar grid has rendered. */
export const calendarScrollTargetAtom = atom<Temporal.ZonedDateTime | null>(
  null
);

export const goToTodayAtom = atom(null, (get, set) => {
  const now = Temporal.Now.zonedDateTimeISO(get(timezoneAtom));
  set(currentDateAtom, now.toPlainDate());
  set(todayTickAtom, (tick) => tick + 1);
  // A fresh request also scrolls when today is already selected.
  set(calendarScrollTargetAtom, now);
});
