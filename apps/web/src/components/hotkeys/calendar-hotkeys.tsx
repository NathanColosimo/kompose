"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import {
  currentDateAtom,
  timezoneAtom,
  visibleDaysCountAtom,
} from "@kompose/state/atoms/current-date";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useHotkeys } from "react-hotkeys-hook";
import { todayPlainDate } from "@/lib/temporal-utils";
import {
  sidebarLeftOpenAtom,
  sidebarLeftViewSelectionAtom,
} from "@/state/sidebar";

// Shared options to prevent hotkeys from firing in input fields
const hotkeyOptions = { enableOnFormTags: false } as const;

/**
 * CalendarHotkeys - Global hotkey bindings for calendar navigation and view control.
 *
 * Hotkeys:
 * - meta+k: Open command bar
 * - 1-7: Set visible days count
 * - w: Set visible days to 7 (week view)
 * - t: Go to today and switch the left sidebar to Today
 * - i: Switch the left sidebar to Inbox
 * - l: Toggle left sidebar
 * - ArrowLeft: Navigate back by visible days count
 * - ArrowRight: Navigate forward by visible days count
 * - Shift+ArrowLeft: Navigate back 1 day
 * - Shift+ArrowRight: Navigate forward 1 day
 *
 * Note: All hotkeys are disabled when focus is on form inputs.
 */
export function CalendarHotkeys() {
  const [currentDate, setCurrentDate] = useAtom(currentDateAtom);
  const [visibleDaysCount, setVisibleDaysCount] = useAtom(visibleDaysCountAtom);
  const setSidebarLeftOpen = useSetAtom(sidebarLeftOpenAtom);
  const setSidebarLeftViewSelection = useSetAtom(sidebarLeftViewSelectionAtom);
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

  // "t" to go to today and focus the Today task view.
  useHotkeys(
    "t",
    () => {
      setCurrentDate(todayPlainDate(timeZone));
      setSidebarLeftViewSelection({ id: "today", type: "base" });
    },
    hotkeyOptions,
    [timeZone, setCurrentDate, setSidebarLeftViewSelection]
  );

  // "i" to focus the Inbox task view.
  useHotkeys(
    "i",
    () => setSidebarLeftViewSelection({ id: "inbox", type: "base" }),
    hotkeyOptions,
    [setSidebarLeftViewSelection]
  );

  // "l" to toggle left sidebar
  useHotkeys("l", () => setSidebarLeftOpen((prev) => !prev), hotkeyOptions, [
    setSidebarLeftOpen,
  ]);

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

  // Shift+Arrow keys to navigate by exactly 1 day
  useHotkeys(
    "shift+ArrowLeft",
    () => setCurrentDate(currentDate.subtract({ days: 1 })),
    hotkeyOptions,
    [currentDate, setCurrentDate]
  );

  useHotkeys(
    "shift+ArrowRight",
    () => setCurrentDate(currentDate.add({ days: 1 })),
    hotkeyOptions,
    [currentDate, setCurrentDate]
  );

  // This component only registers hotkeys, renders nothing
  return null;
}
