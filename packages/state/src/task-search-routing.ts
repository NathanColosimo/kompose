import { Temporal } from "temporal-polyfill";
import { uuidv7 } from "uuidv7";

import type {
  TaskSearchDestination,
  TaskSearchSidebarView,
} from "./task-presentation";

export interface CommandBarTaskOpenRequest {
  date?: Temporal.PlainDate;
  requestId: string;
  sidebarView?: TaskSearchSidebarView;
  target: "calendar" | "sidebar";
  taskId: string;
}

export interface SerializedCommandBarTaskOpenRequest {
  date?: string;
  requestId: string;
  sidebarView?: TaskSearchSidebarView;
  target: "calendar" | "sidebar";
  taskId: string;
}

export function createCommandBarTaskOpenRequest(args: {
  destination: Exclude<TaskSearchDestination, { kind: "unmapped" }>;
  taskId: string;
}): CommandBarTaskOpenRequest {
  if (args.destination.kind === "calendar") {
    return {
      date: args.destination.date,
      requestId: uuidv7(),
      target: "calendar",
      taskId: args.taskId,
    };
  }

  return {
    date: args.destination.date,
    requestId: uuidv7(),
    sidebarView: args.destination.view,
    target: "sidebar",
    taskId: args.taskId,
  };
}

export function serializeCommandBarTaskOpenRequest(
  request: CommandBarTaskOpenRequest
): SerializedCommandBarTaskOpenRequest {
  return {
    ...request,
    date: request.date?.toString(),
  };
}

export function deserializeCommandBarTaskOpenRequest(
  request: SerializedCommandBarTaskOpenRequest
): CommandBarTaskOpenRequest {
  return {
    ...request,
    date: request.date ? Temporal.PlainDate.from(request.date) : undefined,
  };
}
