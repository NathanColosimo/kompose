"use client";

import type { CommandBarTaskOpenRequest } from "@kompose/state/task-search-routing";
import type { Temporal } from "temporal-polyfill";
import type { SidebarLeftBaseViewId } from "@/state/sidebar";

export const COMMAND_BAR_TASK_OPEN_EVENT = "command-bar://open-task";

export function applyCommandBarTaskOpenRequest(
  request: CommandBarTaskOpenRequest,
  {
    setCommandBarTaskOpenRequest,
    setCurrentDate,
    setSidebarLeftViewSelection,
  }: {
    setCommandBarTaskOpenRequest: (request: CommandBarTaskOpenRequest) => void;
    setCurrentDate: (date: Temporal.PlainDate) => void;
    setSidebarLeftViewSelection: (selection: {
      id: SidebarLeftBaseViewId;
      type: "base";
    }) => void;
  }
) {
  if (request.target === "calendar" && request.date) {
    setCurrentDate(request.date);
  }

  if (request.target === "sidebar" && request.sidebarView) {
    setSidebarLeftViewSelection({
      type: "base",
      id: request.sidebarView,
    });
  }

  setCommandBarTaskOpenRequest(request);
}
