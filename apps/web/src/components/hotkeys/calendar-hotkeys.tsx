"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useHotkeys } from "react-hotkeys-hook";
import { commandBarOpenAtom } from "@/atoms/command-bar";
import {
  currentDateAtom,
  timezoneAtom,
  visibleDaysCountAtom,
} from "@/atoms/current-date";
import { sidebarLeftOpenAtom, sidebarRightOpenAtom } from "@/atoms/sidebar";
import { todayPlainDate } from "@/lib/temporal-utils";

// Shared options to prevent hotkeys from firing in input fields
const hotkeyOptions = { enableOnFormTags: false } as const;

/**
 * CalendarHotkeys - Global hotkey bindings for calendar navigation and view control.
 *
 * Hotkeys:
 * - meta+k: Open command bar
 * - 1-7: Set visible days count
 * - w: Set visible days to 7 (week view)
 * - t: Go to today
 * - l: Toggle left sidebar
 * - r: Toggle right sidebar
 * - s: Toggle both sidebars (synced)
 * - ArrowLeft: Navigate back by visible days count
 * - ArrowRight: Navigate forward by visible days count
 *
 * Note: All hotkeys are disabled when focus is on form inputs.
 */
export function CalendarHotkeys() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const [visibleDaysCount, setVisibleDaysCount] = useAtom(visibleDaysCountAtom);
  const [sidebarLeftOpen, setSidebarLeftOpen] = useAtom(sidebarLeftOpenAtom);
  const setSidebarRightOpen = useSetAtom(sidebarRightOpenAtom);
  const setCommandBarOpen = useSetAtom(commandBarOpenAtom);
  const timeZone = useAtomValue(timezoneAtom);

  // "meta+k" (cmd+k on Mac) to open command bar
  useHotkeys(
    "meta+k",
    (e) => {
      e.preventDefault(); // Prevent browser's default cmd+k behavior
      setCommandBarOpen(true);
    },
    { enableOnFormTags: true }, // Allow opening even when in form fields
    [setCommandBarOpen]
  );

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
  useHotkeys(
    "t",
    () => setCurrentDate(todayPlainDate(timeZone)),
    hotkeyOptions,
    [timeZone, setCurrentDate]
  );

  // "l" to toggle left sidebar
  useHotkeys("l", () => setSidebarLeftOpen((prev) => !prev), hotkeyOptions, [
    setSidebarLeftOpen,
  ]);

  // "r" to toggle right sidebar
  useHotkeys("r", () => setSidebarRightOpen((prev) => !prev), hotkeyOptions, [
    setSidebarRightOpen,
  ]);

  // "s" to toggle both sidebars (synced - toggle left and set right to match)
  useHotkeys(
    "s",
    () => {
      const newState = !sidebarLeftOpen;
      setSidebarLeftOpen(newState);
      setSidebarRightOpen(newState);
    },
    hotkeyOptions,
    [sidebarLeftOpen, setSidebarLeftOpen, setSidebarRightOpen]
  );

  // Arrow keys to navigate by visible days count
  useHotkeys(
    "ArrowLeft",
    () => setCurrentDate(currentDate.subtract({ days: visibleDaysCount })),
    hotkeyOptions,
    [currentDate, visibleDaysCount, setCurrentDate]
  );

  useHotkeys(
    "ArrowRight",
    () => setCurrentDate(currentDate.add({ days: visibleDaysCount })),
    hotkeyOptions,
    [currentDate, visibleDaysCount, setCurrentDate]
  );

  // This component only registers hotkeys, renders nothing
  return null;
}
