import {
  currentDateAtom,
  todayPlainDateAtom,
  todayTickAtom,
} from "@kompose/state/atoms/current-date";
import { atom } from "jotai";

/**
 * One-shot request, consumed by the calendar grid once rendered. It holds no
 * time, so a request consumed later still scrolls to the actual current time.
 */
export const scrollToNowRequestedAtom = atom(false);

/**
 * One-shot request to open the new-event popover from the keyboard ("c") or
 * the command bar, consumed by the calendar grid: today at the next half
 * hour when today is visible, else 9 AM on the first visible day.
 */
export const createEventRequestedAtom = atom(false);

export const goToTodayAtom = atom(null, (get, set) => {
  set(todayTickAtom, (tick) => tick + 1);
  set(currentDateAtom, get(todayPlainDateAtom));
  // A fresh request also scrolls when today is already selected.
  set(scrollToNowRequestedAtom, true);
});
