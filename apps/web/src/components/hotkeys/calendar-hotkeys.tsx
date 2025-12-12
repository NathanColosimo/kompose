"use client";

import { addDays, startOfToday, subDays } from "date-fns";
import { useAtom } from "jotai";
import { useHotkeys } from "react-hotkeys-hook";
import { currentDateAtom, visibleDaysCountAtom } from "@/atoms/current-date";

// Shared options to prevent hotkeys from firing in input fields
const hotkeyOptions = { enableOnFormTags: false } as const;

/**
 * CalendarHotkeys - Global hotkey bindings for calendar navigation and view control.
 *
 * Hotkeys:
 * - 1-7: Set visible days count
 * - w: Set visible days to 7 (week view)
 * - t: Go to today
 * - ArrowLeft: Navigate back by visible days count
 * - ArrowRight: Navigate forward by visible days count
 *
 * Note: All hotkeys are disabled when focus is on form inputs.
 */
export function CalendarHotkeys() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const [visibleDaysCount, setVisibleDaysCount] = useAtom(visibleDaysCountAtom);

  // Number keys 1-7 to set visible days count
  useHotkeys("1", () => setVisibleDaysCount(1), hotkeyOptions, []);
  useHotkeys("2", () => setVisibleDaysCount(2), hotkeyOptions, []);
  useHotkeys("3", () => setVisibleDaysCount(3), hotkeyOptions, []);
  useHotkeys("4", () => setVisibleDaysCount(4), hotkeyOptions, []);
  useHotkeys("5", () => setVisibleDaysCount(5), hotkeyOptions, []);
  useHotkeys("6", () => setVisibleDaysCount(6), hotkeyOptions, []);
  useHotkeys("7", () => setVisibleDaysCount(7), hotkeyOptions, []);

  // "w" for week view (7 days)
  useHotkeys("w", () => setVisibleDaysCount(7), hotkeyOptions, []);

  // "t" to go to today
  useHotkeys("t", () => setCurrentDate(startOfToday()), hotkeyOptions, []);

  // Arrow keys to navigate by visible days count
  useHotkeys(
    "ArrowLeft",
    () => setCurrentDate(subDays(currentDate, visibleDaysCount)),
    hotkeyOptions,
    [currentDate, visibleDaysCount, setCurrentDate]
  );

  useHotkeys(
    "ArrowRight",
    () => setCurrentDate(addDays(currentDate, visibleDaysCount)),
    hotkeyOptions,
    [currentDate, visibleDaysCount, setCurrentDate]
  );

  // This component only registers hotkeys, renders nothing
  return null;
}
