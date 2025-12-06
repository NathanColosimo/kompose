import type { TaskSelect } from "@kompose/db/schema/task";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";

export type DragDirection = "start" | "end";

export type SlotData = {
  date: Date;
  hour: number;
  minutes: number;
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
      start: Date;
      end: Date;
    }
  | {
      type: "google-event-resize";
      event: GoogleEvent;
      accountId: string;
      calendarId: string;
      start: Date;
      end: Date;
      direction: DragDirection;
    };
