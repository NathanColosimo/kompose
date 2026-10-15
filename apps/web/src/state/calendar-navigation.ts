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

export const goToTodayAtom = atom(null, (get, set) => {
  set(todayTickAtom, (tick) => tick + 1);
  set(currentDateAtom, get(todayPlainDateAtom));
  // A fresh request also scrolls when today is already selected.
  set(scrollToNowRequestedAtom, true);
});
