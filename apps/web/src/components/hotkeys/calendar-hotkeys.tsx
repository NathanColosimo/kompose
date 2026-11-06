"use client";

import { commandBarOpenAtom } from "@kompose/state/atoms/command-bar";
import {
  currentDateAtom,
  visibleDaysCountAtom,
} from "@kompose/state/atoms/current-date";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useHotkeys } from "react-hotkeys-hook";
import { goToTodayAtom } from "@/state/calendar-navigation";
import {
  effectiveVisibleDaysCountAtom,
  sidebarLeftOpenAtom,
  sidebarLeftViewSelectionAtom,
  sidebarRightViewAtom,
  toggleSidebarRightAtom,
} from "@/state/sidebar";

const hotkeyOptions = {
  enableOnFormTags: false,
  ignoreEventWhen: () =>
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
    ) !== null,
} as const;

/**
 * Calendar shortcuts; Cmd+K also works in form fields.
 * See documents/hotkeys.md for the full bindings.
 */
export function CalendarHotkeys() {
  const [sidebarLeftOpen, setSidebarLeftOpen] = useAtom(sidebarLeftOpenAtom);
  const sidebarRightView = useAtomValue(sidebarRightViewAtom);
  const toggleSidebarRight = useSetAtom(toggleSidebarRightAtom);
  const setCurrentDate = useSetAtom(currentDateAtom);
  const setVisibleDaysCount = useSetAtom(visibleDaysCountAtom);
  const navigationStep = useAtomValue(effectiveVisibleDaysCountAtom);
  const setSidebarLeftViewSelection = useSetAtom(sidebarLeftViewSelectionAtom);
  const setCommandBarOpen = useSetAtom(commandBarOpenAtom);
  const goToToday = useSetAtom(goToTodayAtom);

  useHotkeys(
    "meta+k",
    (e) => {
      e.preventDefault(); // Prevent browser's default cmd+k behavior
      setCommandBarOpen(true);
    },
    { enableOnFormTags: true }, // Allow opening even when in form fields
    [setCommandBarOpen]
  );

  useHotkeys("1", () => setVisibleDaysCount(1), hotkeyOptions, []);
  useHotkeys("2", () => setVisibleDaysCount(2), hotkeyOptions, []);
  useHotkeys("3", () => setVisibleDaysCount(3), hotkeyOptions, []);
  useHotkeys("4", () => setVisibleDaysCount(4), hotkeyOptions, []);
  useHotkeys("5", () => setVisibleDaysCount(5), hotkeyOptions, []);
  useHotkeys("6", () => setVisibleDaysCount(6), hotkeyOptions, []);
  useHotkeys("7", () => setVisibleDaysCount(7), hotkeyOptions, []);

  useHotkeys("w", () => setVisibleDaysCount(7), hotkeyOptions, []);

  useHotkeys(
    "t",
    () => {
      goToToday();
      setSidebarLeftViewSelection({ id: "today", type: "base" });
    },
    hotkeyOptions,
    [goToToday, setSidebarLeftViewSelection]
  );

  useHotkeys(
    "i",
    () => setSidebarLeftViewSelection({ id: "inbox", type: "base" }),
    hotkeyOptions,
    [setSidebarLeftViewSelection]
  );

  useHotkeys("l", () => setSidebarLeftOpen((prev) => !prev), hotkeyOptions, [
    setSidebarLeftOpen,
  ]);

  useHotkeys("r", () => toggleSidebarRight(), hotkeyOptions, [
    toggleSidebarRight,
  ]);

  // Close both only when both are open; otherwise open both.
  useHotkeys(
    "s",
    () => {
      const newState = !(sidebarLeftOpen && sidebarRightView !== "closed");
      setSidebarLeftOpen(newState);
      toggleSidebarRight(newState);
    },
    hotkeyOptions,
    [setSidebarLeftOpen, toggleSidebarRight, sidebarLeftOpen, sidebarRightView]
  );

  useHotkeys(
    "ArrowLeft",
    () => setCurrentDate((date) => date.subtract({ days: navigationStep })),
    hotkeyOptions,
    [navigationStep, setCurrentDate]
  );

  useHotkeys(
    "ArrowRight",
    () => setCurrentDate((date) => date.add({ days: navigationStep })),
    hotkeyOptions,
    [navigationStep, setCurrentDate]
  );

  useHotkeys(
    "shift+ArrowLeft",
    () => setCurrentDate((date) => date.subtract({ days: 1 })),
    hotkeyOptions,
    [setCurrentDate]
  );

  useHotkeys(
    "shift+ArrowRight",
    () => setCurrentDate((date) => date.add({ days: 1 })),
    hotkeyOptions,
    [setCurrentDate]
  );

  return null;
}
