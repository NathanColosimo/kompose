import { commandBarTaskOpenRequestAtom } from "@kompose/state/atoms/command-bar";
import { currentDateAtom } from "@kompose/state/atoms/current-date";
import type { CommandBarTaskOpenRequest } from "@kompose/state/task-search-routing";
import { atom } from "jotai";
import { sidebarLeftOpenAtom, sidebarLeftViewSelectionAtom } from "./sidebar";

/** Each mounted popover subscribes only to requests for its task and surface. */
export function selectTaskOpenRequestAtom(
  taskId: string | undefined,
  target: CommandBarTaskOpenRequest["target"]
) {
  return atom((get) => {
    const request = get(commandBarTaskOpenRequestAtom);
    return request?.taskId === taskId && request?.target === target
      ? request
      : null;
  });
}

/** Shows the task's day or sidebar view, then asks its edit popover to open. */
export const applyCommandBarTaskOpenRequestAtom = atom(
  null,
  (_get, set, request: CommandBarTaskOpenRequest) => {
    if (
      (request.target === "calendar" || request.target === "sidebar") &&
      request.date
    ) {
      set(currentDateAtom, request.date);
    }

    if (request.target === "sidebar" && request.sidebarView) {
      set(sidebarLeftOpenAtom, true);
      set(sidebarLeftViewSelectionAtom, {
        id: request.sidebarView,
        type: "base",
      });
    }

    set(commandBarTaskOpenRequestAtom, request);
  }
);
