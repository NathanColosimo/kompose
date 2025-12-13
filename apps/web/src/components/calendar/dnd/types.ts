import type { TaskSelect } from "@kompose/db/schema/task";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { Temporal } from "temporal-polyfill";

export type DragDirection = "start" | "end";

/** Data attached to droppable time slots */
export type SlotData = {
  dateTime: Temporal.ZonedDateTime;
};

export type PreviewRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type DragData =
  | {
      type: "task";
      task: TaskSelect;
    }
  | {
      type: "task-resize";
      task: TaskSelect;
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
