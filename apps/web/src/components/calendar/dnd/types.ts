import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { Temporal } from "temporal-polyfill";

export type DragDirection = "start" | "end";

/** Data attached to droppable time slots */
export interface SlotData {
  dateTime: Temporal.ZonedDateTime;
}

export interface PreviewRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type DragData =
  | {
      type: "task";
      task: TaskSelectDecoded;
    }
  | {
      type: "task-resize";
      task: TaskSelectDecoded;
      direction: DragDirection;
    }
  | {
      type: "google-event";
      event: GoogleEvent;
      accountId: string;
      calendarId: string;
      start: Temporal.ZonedDateTime;
      end: Temporal.ZonedDateTime;
    }
  | {
      type: "google-event-resize";
      event: GoogleEvent;
      accountId: string;
      calendarId: string;
      start: Temporal.ZonedDateTime;
      end: Temporal.ZonedDateTime;
      direction: DragDirection;
    };
