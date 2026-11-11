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
 * hour when today is visible, else 9 AM on the first visible day. Holds the
 * time it was made (Date.now()), so one left waiting goes stale.
 */
export const createEventRequestedAtom = atom<number | null>(null);

/** A request waiting longer than this (calendars never loaded) is dropped. */
export const CREATE_EVENT_REQUEST_TTL_MS = 10_000;

export const goToTodayAtom = atom(null, (get, set) => {
  set(todayTickAtom, (tick) => tick + 1);
  set(currentDateAtom, get(todayPlainDateAtom));
  // A fresh request also scrolls when today is already selected.
  set(scrollToNowRequestedAtom, true);
});
