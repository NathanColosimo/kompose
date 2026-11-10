import type { TaskSelectDecoded } from "@kompose/api/routers/task/contract";
import type { Event as GoogleEvent } from "@kompose/google-cal/schema";
import type { Temporal } from "temporal-polyfill";

export type DragDirection = "start" | "end";

export interface DayColumnDropData {
  date: Temporal.PlainDate;
  timeZone: string;
  type: "day-column";
}

export interface PreviewRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export type DragData =
  | {
      type: "task";
      task: TaskSelectDecoded;
      /**
       * Minutes from the item's start to the top of the dragged block: zero,
       * except on the second day of an overnight item.
       */
      grabOffsetMinutes?: number;
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
      /** The whole event's times, not the drawn day's part. */
      start: Temporal.ZonedDateTime;
      end: Temporal.ZonedDateTime;
      /**
       * Minutes from the item's start to the top of the dragged block: zero,
       * except on the second day of an overnight item.
       */
      grabOffsetMinutes?: number;
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
